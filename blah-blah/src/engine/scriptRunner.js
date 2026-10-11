 
import React from 'react';
import { pushCompileError, pushRuntimeError, getConsoleGeneration } from './scriptConsole.js';
import ReactDOM from 'react-dom';
import ReactDOMClient from 'react-dom/client';
import * as esbuild from 'esbuild-wasm';
import { bundleScript, transformScript } from './scriptBundler.js';
import { 
  MotionTweenContext, 
  Easing, 
  Ease, 
  LoopType, 
  MathUtils, 
  interpolate, 
  spring,
  Tween,
} from './motionTween.js';
import { resolveScriptProps } from './referenceTypes.js';
import { parseFieldAttributes } from './inspectorAttributes.js';
// Runtime errors are reported against the USER'S line, not the generated one:
// scriptBundler hands us an external esbuild source map, this decodes it.
import { decodeSourceMap, originalPosition, formatSourceContext } from './sourceMap.js';
// The prop-declaration helpers (num/bool/color/…/group/row/Presets). They are
// injected as globals below, in BOTH evaluators, so a script can call them
// with no import line; scriptBundler.js also serves this module as the
// `blahblah` virtual module for scripts that prefer an explicit import.
import { PROP_HELPER_NAMES, derivePropLabel, propHelperValues } from './scriptProps.js';
 
/**
 * Cache for compiled JavaScript/JSX modules to ensure 60fps performance without recompiling.
 *
 * All four source-keyed caches below are capped at CACHE_LIMIT entries with a
 * simple LRU (oldest key evicted on insert). Every edit in the script editor
 * produces a NEW code string and therefore a new key, so without a cap these
 * maps grow for the lifetime of the app; a few thousand edits of a long
 * script is enough to retain a few thousand compiled modules.
 */
const CACHE_LIMIT = 50;

const compiledModuleCache = new Map();
const propsSchemaCache = new Map();
const lastErrorCache = new Map();
const scriptKindCache = new Map();
// Validation warnings per source string (Task 4), filled alongside the schema.
const propsWarningsCache = new Map();
// The console generation at which each script's compile error was last
// pushed, so a still-broken script re-emits once after clearConsole().
const lastErrorGeneration = new Map();

/**
 * Insert into one of the capped caches, evicting the oldest entry once size
 * exceeds CACHE_LIMIT. Map preserves insertion order, so the first key is the
 * least recently used; re-inserting refreshes recency. Returns the value so
 * call sites can `return cacheSet(...)`.
 */
function cacheSet(map, key, value) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size > CACHE_LIMIT) {
    map.delete(map.keys().next().value);
  }
  return value;
}

// ─── freeze guard (slow / runaway script callbacks) ──────────────────────
//
// JS cannot interrupt a true infinite loop on the main thread — nothing else
// runs until the loop itself yields. This does NOT prevent the freeze; it
// catches a script after a callback blew past its budget, disables that exact
// script (keyed by its source string, so editing or saving re-enables it), and
// says why in the Console. That turns "the editor hangs every second" into one
// clear message and stops the freeze from recurring.
//
// Budgets are PER METHOD, because "slow" means very different things for
// one-time setup and for a per-frame callback: a Three.js scene, a first
// shader compile or a font/texture load in onMount legitimately takes seconds,
// while an onUpdate that takes 500ms is already a hang. A single shared 500ms
// budget (the previous behaviour) disabled healthy scripts on their very first
// frame — and, because the disabled flag was keyed only by the code string, a
// save of otherwise-identical code could not clear it.
export const SLOW_CALL_BUDGETS = {
  // One-time work: scene setup, shader compile, asset load, re-parenting.
  onMount: 5000,
  onContainerReattach: 5000,
  // Per-frame / per-seek work: a 60fps frame has ~16ms of budget to stay
  // smooth, so even 500ms is the "this will never finish" line rather than a
  // performance warning.
  onStart: 500,
  onUpdate: 500,
  onSeek: 500,
};

/** Budget for one script callback. Unknown methods get the per-frame budget. */
export function getCallBudgetMs(methodName) {
  return SLOW_CALL_BUDGETS[methodName] ?? SLOW_CALL_BUDGETS.onUpdate;
}

// The per-frame budget, kept as a named export because it is the default
// every other budget is compared against.
export const SLOW_CALL_MS = SLOW_CALL_BUDGETS.onUpdate;

// Two strikes: ONE over-budget call is forgiven — a single slow first frame, a
// cold shader compile, a GC pause, a breakpoint. Only a script that takes too
// long TWICE with the same method is disabled, and the counter is cleared by
// resetScriptDisabled (a save from the editor, or the Inspector's Re-enable).
const SLOW_STRIKES = 2;
const slowScriptCache = new Set();
// scriptCode -> Map(methodName -> how many over-budget calls so far).
const slowStrikeCounts = new Map();

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** True once a script has been disabled for repeatedly taking too long. */
export function isScriptDisabled(scriptCode) {
  return !!scriptCode && slowScriptCache.has(scriptCode);
}

/**
 * Record one over-budget callback. The first strike is forgiven; the second
 * disables the script and explains why, once.
 */
export function markScriptSlow(scriptCode, scriptName, elapsedMs, methodName = 'onUpdate') {
  if (!scriptCode || slowScriptCache.has(scriptCode)) return;
  let strikes = slowStrikeCounts.get(scriptCode);
  if (!strikes) {
    strikes = new Map();
    slowStrikeCounts.set(scriptCode, strikes);
    // Same cap as the compile caches: a few thousand edits must not grow this
    // map for the lifetime of the app.
    if (slowStrikeCounts.size > CACHE_LIMIT) {
      slowStrikeCounts.delete(slowStrikeCounts.keys().next().value);
    }
  }
  const count = (strikes.get(methodName) || 0) + 1;
  strikes.set(methodName, count);
  if (count < SLOW_STRIKES) return; // one slow call is forgiven

  slowScriptCache.add(scriptCode);
  pushRuntimeError(
    `Script paused: ${methodName}() took ${Math.round(elapsedMs)}ms twice (budget ${getCallBudgetMs(methodName)}ms), which usually means an infinite or very heavy loop. Press Re-enable in the Inspector, or edit the code and save.`,
    scriptName || 'script',
  );
}

/**
 * Clear a script's disabled state and its strike counters. Called when the
 * user presses Save in the editor — even when the code string is unchanged,
 * because saving is an explicit "try this again" — and by the Inspector's
 * Re-enable button.
 */
export function resetScriptDisabled(scriptCode) {
  if (!scriptCode) return;
  slowScriptCache.delete(scriptCode);
  slowStrikeCounts.delete(scriptCode);
}

// ─── runtime error → original line (source maps) ─────────────────────────
//
// The compiled script runs inside `new Function(...)`, so a runtime error's
// stack points at a line in the GENERATED body. esbuild gave us a real source
// map for that body (see scriptBundler.js); these helpers keep the decoded map
// for each compiled script so formatRuntimeError can turn the generated line
// back into the line the user actually wrote.
//
// Two offsets sit between a generated line and a stack line:
//   * V8 wraps the body as "function anonymous(a,b\n) {\n<body>\n}", so the
//     header is FUNCTION_HEADER_LINES lines tall.
//   * the module wrapper adds its own prefix before the user's code.
// Both are measured, never guessed — see the "runtime error line mapping" tests
// in scriptCompile.test.js, which assert an exact line number.
const FUNCTION_HEADER_LINES = 2;

/** Per compiled script: decoded map + the wrapper's line offset. */
const runtimeMapCache = new Map(); // scriptCode -> entry
const runtimeMapByName = new Map(); // sanitised script name -> entry

/** Sanitise a script name for use inside a `//# sourceURL=` marker. */
export function sanitizeScriptName(scriptName) {
  return String(scriptName || 'script').replace(/[^A-Za-z0-9_.-]/g, '_') || 'script';
}

/** The `blahblah-script:` marker every compiled script's frames carry. */
export function scriptSourceURL(scriptName) {
  return `blahblah-script:${sanitizeScriptName(scriptName)}`;
}

function capCache(map) {
  while (map.size > CACHE_LIMIT) map.delete(map.keys().next().value);
}

/**
 * Remember the source map a compile produced, so a later runtime error can be
 * mapped. Also indexed by the sanitised script name, because
 * formatRuntimeError only receives the name (not the code).
 */
function registerRuntimeMap(scriptCode, scriptName, mapJson, wrapperLineOffset) {
  if (!scriptCode) return;
  const entry = {
    name: sanitizeScriptName(scriptName),
    decoded: mapJson ? decodeSourceMap(mapJson) : null,
    offset: wrapperLineOffset,
  };
  runtimeMapCache.set(scriptCode, entry);
  capCache(runtimeMapCache);
  runtimeMapByName.set(entry.name, entry);
  capCache(runtimeMapByName);
}

/**
 * Find the first frame that belongs to a compiled script (`blahblah-script:`)
 * and map it back to the script's own line.
 *
 * @param {string} stack
 * @param {string} [scriptName] When given, only a frame for that script is
 *   considered — one script's error must never be reported against another's
 *   source. When omitted, any known script name found in the stack is used
 *   (the stack names the script itself).
 * @returns {{displayName: string, line: number, column: number, content: string|null}|null}
 */
function mapRuntimeFrame(stack, scriptName) {
  if (!stack) return null;
  const frameRe = /blahblah-script:([A-Za-z0-9_.-]+):(\d+):(\d+)/g;
  const wantedName = scriptName ? sanitizeScriptName(scriptName) : null;
  let frame;
  while ((frame = frameRe.exec(stack))) {
    const name = frame[1];
    if (wantedName && name !== wantedName) continue;
    const entry = runtimeMapByName.get(name);
    if (!entry || !entry.decoded) continue;
    // Stack lines are 1-based and count the whole `new Function` source:
    // header first, then the wrapper prefix, then the esbuild output.
    const generatedLine = Number(frame[2]) - FUNCTION_HEADER_LINES - entry.offset;
    if (generatedLine < 1) continue;
    const pos = originalPosition(entry.decoded, generatedLine, Number(frame[3]));
    if (!pos) continue;
    return {
      displayName: pos.source || name,
      line: pos.line,
      column: pos.column,
      content: pos.content,
    };
  }
  return null;
}

/**
 * Message + stack, for a runtime error the Console should show in full.
 *
 * When the error came from a compiled script, this points at the user's own
 * line — `--> MyScript.jsx:12:5` plus the offending source line and a caret —
 * mirroring formatBundleError's style for compile errors. When the position
 * cannot be mapped (no map, a frame outside the script, a native error) it
 * falls back to the raw message + stack, exactly as before.
 */
export function formatRuntimeError(err, context, scriptName) {
  const msg = err?.message || String(err);
  const stack = err?.stack ? `\n${err.stack}` : '';
  const header = context ? `${context}: ${msg}` : msg;
  const mapped = mapRuntimeFrame(err?.stack, scriptName);
  if (!mapped) return `${header}${stack}`;
  return `${header}\n --> ${mapped.displayName}:${mapped.line}:${mapped.column}${formatSourceContext(mapped.content, mapped.line, mapped.column)}`;
}
 
/**
 * Scripts whose code contains real ESM `import` statements and which have
 * NOT finished their one-time async bundle yet. These are distinct from
 * compile ERRORS: a pending script is expected to resolve itself shortly
 * (first npm fetch + bundle), so the Inspector shows a "Resolving
 * imports…" badge instead of a red error badge while it's in flight.
 */
const pendingBundleCache = new Set();
 
// ─── esbuild-wasm transpiler (background precompile only) ────────────────────
//
// compileScriptModule is called synchronously from inside React's useMemo
// (EntityRenderer) and the export render loop, so it can NEVER await
// anything and can NEVER call esbuild.transform() (which is always
// async in the browser build — there is no synchronous transformSync
// here). The previous implementation tried to fake synchronous access
// to a promise's result by reading a `let result` variable right after
// firing `.then()` with no `await`; that variable is guaranteed to
// still be `null` at that point (the `.then` callback only runs once
// the current synchronous stack unwinds), so esbuild's output was
// silently discarded on every call and the regex transpiler
// (`transpileJsxToJs`) ran for 100% of scripts regardless of whether
// esbuild had initialised.
//
// Fix: `compileScriptModule` always uses the synchronous regex
// transpiler directly — no swappable "active" transpiler, no fake-sync
// trick. Separately, `precompileWithBundler(scriptCode, dirHandle)` is an
// explicit async function that runs the *real* esbuild bundler for
// scripts containing `import` statements (resolving npm packages once
// via esm.sh + persistent cache, local scripts/ files, and React shims),
// then overwrites the existing `compiledModuleCache` entry for that
// exact source string in place. Nothing on the render path awaits it, so
// it never blocks or races the sync path; scripts without imports never
// touch it.
 
/**
 * Rewrites an esbuild ESM transform's export syntax into the
 * CommonJS-style assignments that compileScriptModule's module wrapper
 * expects (it runs the compiled code inside `new Function()` with a
 * bare `module`/`exports`, not a real ES module).
 */
function toCommonJsExports(js) {
  // 1. export default class/function Foo  →  strip the export keyword
  js = js.replace(
    /export\s+default\s+(class|function)\s+([A-Za-z0-9_$]+)/g,
    (_, kw, name) => `${kw} ${name}`,
  );
  // 2. Any remaining `export default <expr>`  →  `module.exports.default = <expr>`
  if (/export\s+default\s/.test(js)) {
    js = js.replace(/export\s+default\s+/g, 'module.exports.default = ');
  }
  // 3. export const / let / var / function / class  →  const / let / ...
  js = js.replace(/\bexport\s+(const|let|var|function|class)\b/g, '$1');
  // 4. export { … } re-exports — drop them (scripts are single-default-export)
  js = js.replace(/export\s*\{[^}]*\};?\s*/g, '');
  return js;
}
 
/** True once `esbuild.initialize()` has resolved successfully. */
let esbuildReady = false;

/**
 * True once `esbuildInitPromise` has SETTLED (success OR failure). Until
 * then, an uncompiled script is "pending" rather than a compile error: the
 * wasm binary is still loading and the async compile is about to run. Only
 * after this is true AND esbuildReady is false do we know esbuild is
 * unavailable and fall back to the regex transpiler.
 */
let esbuildInitSettled = false;
 
/** Resolves once `esbuild.initialize()` finishes (success or failure). */
const esbuildInitPromise = (async () => {
  try {
    let initOpts;
    if (typeof window === 'undefined') {
      // Node build of esbuild-wasm loads its own wasm binary.
      initOpts = { worker: false };
    } else {
      // Browser (and Tauri webview) build needs the wasm binary reachable
      // by URL. Default: /esbuild.wasm — the copy scripts/
      // copy-esbuild-wasm.mjs puts in public/, which Vite bundles into the
      // frontend (works offline once packaged). Under Tauri we prefer the
      // resource-packaged copy resolved via resolveResource() and turned
      // into an asset URL with convertFileSrc(), so esbuild keeps working
      // fully offline even if the frontend asset fetch path ever changes;
      // if the resource isn't bundled (e.g. `tauri dev`), fall back to the
      // frontend copy at /esbuild.wasm.
      let wasmURL = '/esbuild.wasm';
      try {
        const { isTauri } = await import('../services/tauriFsAdapter');
        if (isTauri()) {
          const { resolveResource } = await import('@tauri-apps/api/path');
          const { convertFileSrc } = await import('@tauri-apps/api/core');
          wasmURL = convertFileSrc(await resolveResource('esbuild.wasm'));
        }
      } catch (err) {
        console.warn('esbuild-wasm: packaged resource unavailable, using /esbuild.wasm:', err);
      }
      initOpts = { wasmURL, worker: false };
    }
    await esbuild.initialize(initOpts);
    esbuildReady = true;
  } catch (err) {
    console.warn('esbuild-wasm init failed, staying on regex transpiler:', err);
  } finally {
    // Whatever happened, the sync path can now stop treating every script as
    // "still starting up": either esbuild is ready (compile via esbuild) or
    // it is not (regex fallback).
    esbuildInitSettled = true;
  }
})();
 
// ─── real `import` support (the async/sync split) ────────────────────────
//
// compileScriptModule is called synchronously from React's useMemo and the
// export loop, so it can NEVER await a bundle. Real imports are therefore
// compiled by `precompileWithBundler` — an explicit async path that runs
// esbuild's build() (real module-graph resolution: npm packages via
// packageResolver, local files via the File System Access API), then
// overwrites compiledModuleCache for that exact script string. The sync
// path treats any script whose code contains an `import` statement as
// "pending" until that async bundle lands, instead of feeding it to the
// regex transpiler (which would silently delete the import and leave the
// script referencing undefined names). Scripts with NO imports never touch
// any of this — they compile through the regex path exactly as before.
 
/**
 * All external specifiers this script statically imports, as strings
 * ('three', './helpers.js', ...). Used both to decide whether the sync
 * path must wait for the bundler, and by tests. Not a real parse — esbuild
 * is the source of truth for what actually resolves; this is just the
 * cheap gate that routes import-containing scripts away from the regex
 * transpiler.
 *
 * Implemented as a tiny scanner (not regex over the raw text) so comments
 * and string literals can NEVER fake an import: it walks the code keeping
 * track of '//' / '/* *\/' comments and ' " ` string state, and only
 * captures a specifier at the exact positions the grammar allows:
 *
 *   - after `import` with only whitespace/comments between (`import 'x'`),
 *   - after the `from` of an import/export statement (`… from 'x'`),
 *   - as the literal argument of `import('x')`.
 *
 * Everything else is just source text. In particular `export` does NOT open a
 * specifier window on its own: `export default function A(){ return 'x'; }`
 * and `export const NAME = 'hello'` are declarations whose strings are data,
 * not imports (the previous version reported 'x' and 'hello' as packages and
 * sent those scripts to the network bundler, which then failed). Only
 * `export { … } from 'x'` and `export * from 'x'` have a specifier. `import.meta`
 * is not an import either.
 */
export function extractImportSpecifiers(code) {
  if (!code) return [];
  const specs = [];
  const n = code.length;
 
  let i = 0;
  let quote = null; // ' " or ` when inside a string literal
  let lineComment = false;
  let blockComment = false;
  // Statement state. `export` alone is not an import statement — only a
  // `from` clause makes it one — so a declaration keyword clears it again.
  let inImport = false; // inside an `import …` statement
  let inExport = false; // inside an `export …` statement that may re-export
  let braceDepth = 0; // { … } nesting inside the current statement
 
  const isWordChar = (ch) => /[A-Za-z0-9_$]/.test(ch);
  const isIdentStart = (ch) => /[A-Za-z_$]/.test(ch);
  // Words that turn an `export` into a plain declaration — proof that no
  // `from` clause can follow.
  const DECLARATION_WORDS = new Set(['const', 'let', 'var', 'function', 'class', 'default', 'async']);
 
  // Skip whitespace and comments. `import /* c */ 'x'` and 
  // `import /* c */ { a } from 'x'` are both legal, and a multi-line import
  // always has newlines between the keywords.
  const skipTrivia = (from) => {
    let k = from;
    while (k < n) {
      const c = code[k];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { k++; continue; }
      if (c === '/' && code[k + 1] === '/') { k += 2; while (k < n && code[k] !== '\n') k++; continue; }
      if (c === '/' && code[k + 1] === '*') {
        k += 2;
        while (k < n && !(code[k] === '*' && code[k + 1] === '/')) k++;
        k = Math.min(n, k + 2);
        continue;
      }
      break;
    }
    return k;
  };
 
  // The character before `idx`, ignoring whitespace: `obj.from('x')` must not
  // be read as an import `from` clause.
  const prevSignificantChar = (idx) => {
    for (let k = idx - 1; k >= 0; k--) {
      const c = code[k];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') continue;
      return c;
    }
    return '';
  };
 
  // Read the specifier if a plain ' or " literal starts exactly at `at`.
  const readSpecifierAt = (at) => {
    const c = code[at];
    if (c !== '"' && c !== "'") return null;
    let j = at + 1;
    while (j < n && code[j] !== c) {
      if (code[j] === '\\') j++;
      j++;
    }
    return { spec: code.slice(at + 1, j), end: j + 1 };
  };
  const pushSpecifier = (lit) => {
    if (lit && lit.spec && !specs.includes(lit.spec)) specs.push(lit.spec);
  };
 
  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];
 
    if (lineComment) {
      if (ch === '\n' || ch === '\r') lineComment = false;
      i++;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') blockComment = false;
      i++;
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 2;
      continue;
    }
 
    if (isIdentStart(ch)) {
      let j = i;
      while (j < n && isWordChar(code[j])) j++;
      const word = code.slice(i, j);
 
      if (word === 'import') {
        const after = skipTrivia(j);
        // `import 'x'` — a side-effect import: the very next thing is the
        // specifier.
        const lit = readSpecifierAt(after);
        if (lit) {
          pushSpecifier(lit);
          i = lit.end;
          continue;
        }
        if (code[after] === '(') {
          // Dynamic import: `import('x')` has a specifier, `import(expr)` does
          // not. `import.meta` falls through without one too.
          pushSpecifier(readSpecifierAt(skipTrivia(after + 1)));
          i = j;
          continue;
        }
        inImport = true;
        i = j;
        continue;
      }
 
      if (word === 'export') {
        inExport = true;
        i = j;
        continue;
      }
 
      if (DECLARATION_WORDS.has(word)) {
        // `export const/let/var/function/class/default` is a declaration, never
        // an import: any string after it is data. This is the fix for
        // `export default function A(){ return 'x'; }`.
        inExport = false;
      } else if (word === 'from' && (inImport || inExport) && prevSignificantChar(i) !== '.') {
        const lit = readSpecifierAt(skipTrivia(j));
        if (lit) {
          pushSpecifier(lit);
          i = lit.end;
          continue;
        }
      }
      i = j;
      continue;
    }
 
    if (ch === '"' || ch === "'" || ch === '`') {
      // An ordinary string/template literal: consumes its own content, so a
      // `from 'x'` written inside one can never be mistaken for an import.
      quote = ch;
      i++;
      continue;
    }
 
    // Statement separators. A newline ends the statement only OUTSIDE an
    // import clause's braces, so `import {\n a,\n b\n} from 'x'` still finds
    // its `from`.
    if (ch === ';') {
      inImport = false;
      inExport = false;
      braceDepth = 0;
    } else if (ch === '{' && (inImport || inExport)) {
      braceDepth += 1;
    } else if (ch === '}' && braceDepth > 0) {
      braceDepth -= 1;
    } else if (ch === '\n' && braceDepth === 0) {
      inImport = false;
      inExport = false;
    }
    i++;
  }
 
  return specs;
}
 
/** True if the script contains any static import statement. */
export function hasImportStatements(code) {
  return extractImportSpecifiers(code).length > 0;
}
 
/** Tells the Inspector whether a script is waiting on its first bundle. */
export function isScriptBundlePending(scriptCode) {
  return !!scriptCode && pendingBundleCache.has(scriptCode);
}
 
/**
 * Format a bundle/compile error in a Rust-like structured style:
 *
 *   error[E001]: Cannot find name 'fooBar'
 *    --> entry.jsx:12:5
 *    |
 *    12 |   fooBar();
 *    |   ^^^^^^ not found in scope
 *
 * This makes errors trivially readable both for humans and AI code fixers.
 */
function formatBundleError(err) {
  // esbuild errors array — may have multiple
  const esbuildErrors = err?.errors;
  if (esbuildErrors && esbuildErrors.length > 0) {
    return esbuildErrors
      .map((e, i) => {
        const loc = e.location;
        let out = `error[E${String(i + 1).padStart(3, '0')}]: ${e.text}`;
        if (loc) {
          out += `\n --> ${loc.file || 'entry.jsx'}:${loc.line}:${loc.column + 1}`;
          if (loc.lineText) {
            const lineNum = String(loc.line);
            const pad = ' '.repeat(lineNum.length);
            out += `\n ${pad}|`;
            out += `\n ${lineNum} | ${loc.lineText}`;
            const caretCol = loc.column;
            const caretLen = loc.length || e.text?.length || 1;
            out += `\n ${pad} | ${' '.repeat(caretCol)}${'~'.repeat(Math.max(1, caretLen))}`;
          }
          if (e.notes && e.notes.length > 0) {
            e.notes.forEach((note) => {
              out += `\n note: ${note.text}`;
            });
          }
        }
        return out;
      })
      .join('\n\n');
  }
  // SyntaxError / generic JS runtime error from new Function(...)
  if (err instanceof SyntaxError) {
    return `error: SyntaxError — ${err.message}\n note: Check for mismatched braces, missing semicolons, or invalid JSX`;
  }
  return `error: ${err?.message || String(err)}`;
}
 
/** Broadcast that some script finished bundling, so React re-renders. */
function notifyScriptsRecompiled() {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('blahblah:scripts-recompiled'));
  }
}
 
/**
 * Async esbuild compile path for EVERY script — not just ones with imports.
 *
 * Scripts WITH imports go through the full bundler (npm packages via esm.sh
 * once-then-cached, local scripts/ files, React shims); scripts WITHOUT
 * imports go through esbuild.transform. Both produce the same CJS string and
 * both hand back an EXTERNAL source map, so the regex transpiler's nested-brace
 * JSX and TypeScript-annotation bugs no longer affect anything the editor
 * actually runs. Evaluates the result exactly like compileScriptModule and
 * caches it under this exact source string, so the next synchronous
 * compileScriptModule call picks it up. The source map is cached as well
 * (registerRuntimeMap), so a RUNTIME error is reported against the author's own
 * line by formatRuntimeError instead of a line in the generated body.
 *
 * `//# sourceURL=blahblah-script:<name>` is appended to the evaluated body by
 * runCompiledModule, which is what makes those stack frames identifiable as
 * script frames at all.
 *
 * On failure it records a real error in lastErrorCache (shown as the red
 * badge) and leaves any previously-compiled entry untouched. Safe to call
 * speculatively — it never blocks the render path.
 *
 * @param {string} scriptCode
 * @param {*} projectDirHandle File System Access handle for the project
 *   folder (scripts/ is resolved from it). May be null/undefined — the
 *   bundle will then fail on relative imports but still resolve packages.
 * @param {string} [scriptName] Used as the esbuild sourcefile (so errors and
 *   the source map name the user's script), in the stack marker and in Console
 *   messages.
 * @returns {Promise<{ ok: boolean, error?: string }>} The compile result, so
 *   a caller that wants to report it (the script editor) can await it.
 */
export async function precompileWithBundler(scriptCode, projectDirHandle, scriptName) {
  if (!scriptCode) return { ok: true };

  // Mark pending up front: the Inspector should show "Compiling…" while the
  // async compile is in flight, never a false red error.
  pendingBundleCache.add(scriptCode);
  await esbuildInitPromise;

  if (!esbuildReady) {
    // esbuild never initialised (no wasm) — fall back to the regex
    // transpiler so scripts still run, and report its result.
    compileWithRegex(scriptCode, scriptName);
    return lastErrorCache.has(scriptCode)
      ? { ok: false, error: lastErrorCache.get(scriptCode) }
      : { ok: true };
  }

  try {
    // ONE compile path for every script: import-free scripts go through
    // esbuild.transform (JSX + TS, no module graph), scripts with imports
    // through the full bundler. Both emit the same CJS shape + inline map.
    const compiled = hasImportStatements(scriptCode)
      ? await bundleScript(scriptCode, projectDirHandle, scriptName)
      : await transformScript(scriptCode, scriptName);
    const { result: exportedResult, wrapperLineOffset } = runCompiledModule(
      toCommonJsExports(compiled.code),
      scriptName,
      scriptName,
    );
    registerRuntimeMap(scriptCode, scriptName, compiled.map, wrapperLineOffset);
    lastErrorCache.delete(scriptCode);
    lastErrorGeneration.delete(scriptCode);
    pendingBundleCache.delete(scriptCode);
    cacheSet(compiledModuleCache, scriptCode, exportedResult);
    notifyScriptsRecompiled();
    return { ok: true };
  } catch (err) {
    // ── STRICT GATE ── compile failed → never execute, log structured error
    const msg = formatBundleError(err);
    pendingBundleCache.delete(scriptCode);
    cacheSet(lastErrorCache, scriptCode, msg);
    cacheSet(lastErrorGeneration, scriptCode, getConsoleGeneration());
    pushCompileError(msg, scriptName);
    notifyScriptsRecompiled(); // so the badge updates immediately
    return { ok: false, error: msg };
  }
}

 
/**
 * Kick off background bundling for every script that needs it (project
 * load, hot-reload poll, before export). Skips import-free scripts in
 * O(1); never rejects.
 *
 * BUG FIX: hot-reload's poll calls this with a freshly-rebuilt scripts
 * array on every tick that finds ANY file changed under scripts/ — that
 * array previously included every script, not just the one(s) actually
 * edited (see checkScriptsForChanges in projectFileSystem.js). Since
 * compiledModuleCache/pendingBundleCache are keyed by the exact source
 * STRING, an unchanged script's own re-bundle here was a no-op for the
 * cache, but it still awaited a real bundleScript() pass and, on success,
 * called notifyScriptsRecompiled() again — bumping EntityRenderer's
 * scriptsRecompiledTick and forcing every canvas-kind script's
 * useLayoutEffect to re-run, which re-read `compiled` via
 * compileScriptModule and could observe a brief `null` (cache miss window
 * during the redundant re-bundle) before the identical result landed
 * again, tearing the canvas component down and remounting it — restarting
 * any in-flight async work in a script's onMount (e.g. a font fetch) even
 * though ITS code never changed. Skip scripts already sitting in the
 * cache under this exact code string; only genuinely new/changed code
 * (a cache miss) needs a bundle pass.
 */
export async function precompileAllProjectScripts(scripts, projectDirHandle) {
  if (!scripts || scripts.length === 0) return;
  // Compile every script whose exact source string is not already compiled,
  // in flight, or known-broken. Keying on the source string means an
  // unchanged script is skipped in O(1) and only genuinely new/changed code
  // gets a compile pass.
  const needsCompile = (s) =>
    !!s?.code &&
    !compiledModuleCache.has(s.code) &&
    !pendingBundleCache.has(s.code) &&
    !lastErrorCache.has(s.code);
  const toCompile = scripts.filter(needsCompile);
  if (toCompile.length === 0) return;
  // Pass the script NAME through, so Console entries and esbuild errors are
  // labelled with [ScriptName] instead of a bare "script".
  await Promise.allSettled(toCompile.map((s) => precompileWithBundler(s.code, projectDirHandle, s.name)));
}
 
/**
 * Lightweight JSX & TypeScript to JavaScript Transpiler for in-browser live scripting.
 */
export function transpileJsxToJs(codeStr) {
  if (!codeStr) return '';
 
  let code = codeStr;
 
  // 1. Remove TS type imports / interface / type declarations
  code = code.replace(/import\s+type\s+[^;]+;/g, '');
  code = code.replace(/export\s+type\s+[^;]+;/g, '');
  code = code.replace(/export\s+interface\s+[\s\S]*?\n\}/g, '');
  code = code.replace(/interface\s+[\s\S]*?\n\}/g, '');
  code = code.replace(/type\s+[A-Za-z0-9_]+\s*=\s*[^;]+;/g, '');
 
  // 2. Remove TS variable / parameter type annotations (e.g., `: number`, `: string`, `: any`)
  code = code.replace(/:\s*(?:number|string|boolean|any|void|object|Function|React\.[A-Za-z0-9_]+)\b/g, '');
 
  // 3. Remove standard ES module import statements (since scope is injected)
  code = code.replace(/import\s+(?:\{[^}]*\}|\*\s+as\s+[A-Za-z0-9_]+|[A-Za-z0-9_]+)\s+from\s+['"][^'"]+['"];?/g, '');
 
  // 4. Handle export default and export declarations for function execution
  let defaultExportName = null;
 
  code = code.replace(/export\s+default\s+class\s+([A-Za-z0-9_]+)/g, (_, name) => {
    defaultExportName = name;
    return `class ${name}`;
  });
 
  code = code.replace(/export\s+default\s+function\s+([A-Za-z0-9_]+)/g, (_, name) => {
    defaultExportName = name;
    return `function ${name}`;
  });
 
  code = code.replace(/export\s+default\s+/g, 'module.exports.default = ');
 
  code = code.replace(/export\s+(const|let|var|function|class)\s+([A-Za-z0-9_]+)/g, (_, decl, name) => {
    return `${decl} ${name}`;
  });
 
  // 5. Transform standard JSX to React.createElement
  code = transformJsxElements(code);
 
  if (defaultExportName) {
    code += `\nif (typeof ${defaultExportName} !== 'undefined') { module.exports.default = ${defaultExportName}; }\n`;
  }
 
  return code;
}
 
/**
 * Transforms JSX syntax into React.createElement calls
 */
function transformJsxElements(code) {
  // Replace JSX fragments <> ... </>
  code = code.replace(/<>\s*([\s\S]*?)\s*<\/>/g, (_, children) => {
    return `React.createElement(React.Fragment, null, ${parseJsxChildren(children)})`;
  });
 
  // 1. Replace self-closing JSX tags: <Tag prop="val" />
  let prevCode = '';
  let iters = 0;
  while (prevCode !== code && iters < 20) {
    prevCode = code;
    iters++;
    code = code.replace(/<([A-Za-z0-9_$.]+)((?:\s+[^=>\s/]+(?:=(?:"[^"]*"|'[^']*'|\{[^{}]*\}))?)*)\s*\/>/g, 
      (_, tag, rawProps) => {
        const propsObj = parseJsxProps(rawProps);
        const tagExpr = /^[A-Z]/.test(tag) || tag.includes('.') ? tag : `"${tag}"`;
        return `React.createElement(${tagExpr}, ${propsObj})`;
      }
    );
  }
 
  // 2. Iteratively replace innermost paired tags (children contain no '<')
  prevCode = '';
  iters = 0;
  while (prevCode !== code && iters < 30) {
    prevCode = code;
    iters++;
    code = code.replace(/<([A-Za-z0-9_$.]+)((?:\s+[^=>\s]+(?:=(?:"[^"]*"|'[^']*'|\{[^{}]*\}))?)*)\s*>([^<]*)<\/\1>/g,
      (_, tag, rawProps, children) => {
        const propsObj = parseJsxProps(rawProps);
        const tagExpr = /^[A-Z]/.test(tag) || tag.includes('.') ? tag : `"${tag}"`;
        const parsedChildren = parseJsxChildren(children);
        return parsedChildren 
          ? `React.createElement(${tagExpr}, ${propsObj}, ${parsedChildren})`
          : `React.createElement(${tagExpr}, ${propsObj})`;
      }
    );
  }
 
  return code;
}
 
function parseJsxProps(rawProps) {
  if (!rawProps || !rawProps.trim()) return 'null';
  const propPairs = [];
  let pos = 0;
  const str = rawProps.trim();
 
  while (pos < str.length) {
    while (pos < str.length && /\s/.test(str[pos])) pos++;
    if (pos >= str.length) break;
 
    const nameMatch = str.slice(pos).match(/^([A-Za-z0-9_$-]+)/);
    if (!nameMatch) {
      pos++;
      continue;
    }
 
    const propName = nameMatch[1];
    const key = propName === 'class' ? 'className' : propName;
    pos += propName.length;
 
    while (pos < str.length && /\s/.test(str[pos])) pos++;
 
    if (pos < str.length && str[pos] === '=') {
      pos++;
      while (pos < str.length && /\s/.test(str[pos])) pos++;
 
      if (str[pos] === '"' || str[pos] === "'") {
        const q = str[pos];
        pos++;
        const start = pos;
        while (pos < str.length && str[pos] !== q) {
          if (str[pos] === '\\') pos++;
          pos++;
        }
        const val = str.slice(start, pos);
        pos++;
        propPairs.push(`"${key}": ${JSON.stringify(val)}`);
      } else if (str[pos] === '{') {
        let braceDepth = 1;
        pos++;
        const start = pos;
        while (pos < str.length && braceDepth > 0) {
          if (str[pos] === '{') braceDepth++;
          else if (str[pos] === '}') braceDepth--;
          pos++;
        }
        const valExpr = str.slice(start, pos - 1).trim();
        propPairs.push(`"${key}": ${valExpr}`);
      }
    } else {
      propPairs.push(`"${key}": true`);
    }
  }
 
  return propPairs.length > 0 ? `{ ${propPairs.join(', ')} }` : 'null';
}
 
function parseJsxChildren(children) {
  if (!children || !children.trim()) return '';
  const tokens = [];
  let pos = 0;
  const str = children.trim();
 
  while (pos < str.length) {
    while (pos < str.length && /\s/.test(str[pos])) pos++;
    if (pos >= str.length) break;
 
    if (str[pos] === '{') {
      let braceDepth = 1;
      pos++;
      const start = pos;
      while (pos < str.length && braceDepth > 0) {
        if (str[pos] === '{') braceDepth++;
        else if (str[pos] === '}') braceDepth--;
        pos++;
      }
      const expr = str.slice(start, pos - 1).trim();
      if (expr) tokens.push(expr);
    } else if (str.slice(pos).startsWith('React.createElement(')) {
      let parenDepth = 1;
      const start = pos;
      pos += 'React.createElement('.length;
      while (pos < str.length && parenDepth > 0) {
        if (str[pos] === '(') parenDepth++;
        else if (str[pos] === ')') parenDepth--;
        else if (str[pos] === '"' || str[pos] === "'") {
          const q = str[pos];
          pos++;
          while (pos < str.length && str[pos] !== q) {
            if (str[pos] === '\\') pos++;
            pos++;
          }
        }
        pos++;
      }
      tokens.push(str.slice(start, pos));
    } else {
      const start = pos;
      while (pos < str.length && str[pos] !== '{' && !str.slice(pos).startsWith('React.createElement(')) {
        pos++;
      }
      const text = str.slice(start, pos).trim();
      if (text) {
        tokens.push(JSON.stringify(text));
      }
    }
  }
 
  return tokens.join(', ');
}
 
/**
 * Builds a plain default object from a struct's subfield schema.
 * Used by extractScriptProps and resolveScriptProps to seed initial values.
 *
 * @param {object} subfields - The `fields` map from a struct prop definition
 * @returns {object} - Plain object with each subfield's default value
 */
export function buildStructDefault(subfields) {
  if (!subfields || typeof subfields !== 'object') return {};
  const result = {};
  for (const [key, def] of Object.entries(subfields)) {
    if (typeof def === 'object' && def !== null) {
      if (def.type === 'number') result[key] = def.default ?? 0;
      else if (def.type === 'boolean') result[key] = def.default ?? false;
      else result[key] = def.default ?? '';
    } else {
      result[key] = def;
    }
  }
  return result;
}

/**
 * Extracts public props schema for the Unity-style Inspector.
 *
 * Supported types: number | boolean | string | color | select | textarea |
 *                  font | entity | asset | struct | struct[] | button |
 *                  string[] | number[] | color[] | boolean[] | select[] |
 *                  asset[] | entity[] | array
 *
 * A definition may also carry Odin-style *attributes* (`box`, `tab`,
 * `showIf`, `toggleLeft`, `selectButton`, `controls`, `button`, …) describing
 * layout and conditions. They are copied onto the field verbatim; the engine
 * is in engine/inspectorAttributes.js and the rendering in
 * inspector/InspectorField.jsx. An attribute-free field is unchanged.
 *
 * `font` renders the searchable Font Family picker in the Inspector and
 * gives the script a plain family-name string (not keyframeable).
 *
 * struct / struct[] shape:
 *   { type: 'struct',   label: 'My Group', fields: { key: { type, default, ...} } }
 *   { type: 'struct[]', label: 'My List',  fields: { key: { type, default, ...} } }
 *
 * The props OBJECT may also be built with the prop helpers
 * (engine/scriptProps.js: num/bool/color/text/select/asset/entity/font/button,
 * group/row, and the Presets.* blocks). Those are injected as parameters of
 * the evaluator below, so a helper call in the object literal resolves here
 * exactly as it does at runtime — no import line, and no parser change: the
 * helpers return the same plain objects literals always did.
 *
 * Because a helper cannot know which key it is assigned to, it marks its
 * result and `derivePropLabel` fills the label in here, where the key IS
 * known (`startDelay` + `unit: 's'` -> "Start Delay (s)"). Only marked fields
 * are relabelled, so an old-style literal with no `label` still gets its raw
 * key, unchanged.
 */
/**
 * Finds the `static props = { ... }` (or `props = { ... }` /
 * `Component.props = { ... }`) block in `code` and returns the FULL
 * object-literal source text, including its closing brace — no matter how
 * deeply the object is nested (struct / struct[] fields, arrays, etc).
 *
 * Replaces the previous lazy-regex approach
 * (`/= \{[\s\S]*?\n\s*\};?/`), which stopped at the FIRST line looking
 * like `};` — wrong as soon as the object contains its own nested
 * `{ ... }`, which is exactly what every `struct` / `struct[]` field's
 * `fields:` sub-object does. That bug silently truncated the captured
 * text mid-object, so `new Function(...)` on the result either threw
 * (falling through to the flat-fields-only regex fallback, which does
 * not understand struct/struct[] and spills nested subfields out as
 * top-level props) or produced a malformed schema.
 *
 * This scans forward from the first `{` after the `props =` keyword,
 * counting brace depth, while correctly skipping over string literals
 * (', ", `) and comments (//, block) so a `}`/`{` inside a nested struct
 * schema, a string default, or a comment can never be mis-counted — same
 * "walk it properly" approach as extractImportSpecifiers above, applied
 * to brace matching instead of import statements.
 *
 * @param {string} code
 * @returns {string|null} The object literal source (e.g. "{ speed: ... }"),
 *   or null if no `static props`/`props` assignment is found.
 */
function extractPropsObjectSource(code) {
  const keywordMatch = code.match(/(?:static\s+props|\bprops)\s*=\s*/);
  if (!keywordMatch) return null;

  const searchStart = keywordMatch.index + keywordMatch[0].length;
  let openIdx = searchStart;
  while (openIdx < code.length && /\s/.test(code[openIdx])) openIdx++;
  if (code[openIdx] !== '{') return null;

  let i = openIdx;
  let depth = 0;
  let quote = null; // ' " or ` when inside a string literal
  let lineComment = false;
  let blockComment = false;
  const n = code.length;

  for (; i < n; i++) {
    const ch = code[i];
    const next = code[i + 1];

    if (lineComment) {
      if (ch === '\n' || ch === '\r') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return code.slice(openIdx, i + 1);
      }
    }
  }

  return null;
}

// Every `static props` type the Inspector understands. Anything else is a
// typo ('numbr') and would silently render no control at all.
const KNOWN_PROP_TYPES = new Set([
  'number', 'boolean', 'string', 'color', 'select', 'textarea', 'font',
  'entity', 'asset', 'struct', 'struct[]', 'button', 'array',
  'string[]', 'number[]', 'color[]', 'boolean[]', 'select[]', 'asset[]', 'entity[]',
]);

/** True if `code` defines a method (or static method) named `methodName`. */
function codeHasMethod(code, methodName) {
  if (!methodName || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(methodName)) return true; // can't check → don't warn
  const escaped = methodName.replace(/\$/g, '\\$');
  return new RegExp(`(?:^|[\\s;{(,])${escaped}\\s*\\(`).test(code);
}

/**
 * Collect non-fatal problems with a props schema. NEVER throws — a warning
 * must not stop the props from being registered; it is shown as a badge in
 * the Inspector so a typo is visible instead of silently doing nothing.
 */
function collectPropsWarnings(schemaObj, code, warnings) {
  for (const [name, def] of Object.entries(schemaObj)) {
    // Shorthand values ({ speed: 2.5 }) have nothing to validate.
    if (Array.isArray(def) || typeof def !== 'object' || def === null) continue;
    const { type } = def;

    if (typeof type === 'string' && !KNOWN_PROP_TYPES.has(type)) {
      warnings.push(`"${name}": unknown prop type '${type}'.`);
    }
    if (typeof def.min === 'number' && typeof def.max === 'number' && def.min > def.max) {
      warnings.push(`"${name}": min (${def.min}) is greater than max (${def.max}).`);
    }
    if (type === 'select' && !Array.isArray(def.options)) {
      warnings.push(`"${name}": select has no options array, so the dropdown will be empty.`);
    }
    if (type === 'number' && typeof def.default === 'number' && Number.isFinite(def.default)) {
      if (typeof def.min === 'number' && def.default < def.min) {
        warnings.push(`"${name}": default (${def.default}) is below min (${def.min}).`);
      }
      if (typeof def.max === 'number' && def.default > def.max) {
        warnings.push(`"${name}": default (${def.default}) is above max (${def.max}).`);
      }
    }
    if ((type === 'struct' || type === 'struct[]') &&
        (typeof def.fields !== 'object' || def.fields === null || Array.isArray(def.fields))) {
      warnings.push(`"${name}": ${type} has no \`fields\` sub-schema, so no controls can be shown.`);
    }
    if (type === 'button') {
      const action = def.action || name;
      if (!codeHasMethod(code, action)) {
        warnings.push(`"${name}": button calls '${action}()', but the script defines no such method.`);
      }
    }
  }
}

/**
 * Warnings for a script's props schema: unknown types, min > max, selects
 * without options, defaults outside their range, structs without fields, and
 * buttons whose method does not exist. Also reports the case where the props
 * OBJECT could not be evaluated at all (the regex fallback then runs, which
 * does not understand struct/select — the user should know the schema shown
 * may be incomplete). Returns [] for a clean schema. Never throws.
 */
export function getScriptPropsWarnings(code) {
  if (!code) return [];
  extractScriptProps(code); // fills propsWarningsCache
  return [...(propsWarningsCache.get(code) || [])];
}

/**
 * Extracts public props schema for the Unity-style Inspector.
 */
export function extractScriptProps(code) {
  if (!code) return [];
  if (propsSchemaCache.has(code)) {
    return propsSchemaCache.get(code);
  }
 
  const fields = [];
  const warnings = [];
 
  try {
    // 1. Find `static props = { ... }` via a brace-counting scan that
    // correctly captures the FULL object even when it contains nested
    // objects (struct / struct[] fields) — see extractPropsObjectSource.
    const propsObjectSource = extractPropsObjectSource(code);
    if (propsObjectSource) {
      try {
        // Bound as parameters rather than looked up globally: the object
        // literal is evaluated in its own scope, and this keeps the helpers
        // out of the real global object (so two scripts cannot fight over
        // them, and nothing leaks if evaluation throws).
        const schemaFunc = new Function(...PROP_HELPER_NAMES, `return (${propsObjectSource});`);
        const schemaObj = schemaFunc(...propHelperValues());
        if (schemaObj && typeof schemaObj === 'object') {
          collectPropsWarnings(schemaObj, code, warnings);
          Object.entries(schemaObj).forEach(([name, rawDef]) => {
            const def = derivePropLabel(name, rawDef);
            if (Array.isArray(def)) {
              const itemType = def.length > 0 && typeof def[0] === 'number' ? 'number' : 'string';
              fields.push({
                name,
                type: `${itemType}[]`,
                itemType,
                defaultVal: def,
                label: name,
              });
              return;
            }
            if (typeof def === 'object' && def !== null) {
              const attributes = parseFieldAttributes(def);
              // Action buttons hold no value: they carry the method to call.
              if (def.type === 'button') {
                fields.push({
                  name,
                  type: 'button',
                  label: def.label || name,
                  action: def.action || name,
                  variant: def.variant,
                  ...attributes,
                });
                return;
              }
              // Struct types: single object group or array of objects
              if (def.type === 'struct' || def.type === 'struct[]') {
                fields.push({
                  name,
                  type: def.type,
                  label: def.label || name,
                  fields: def.fields || {},
                  defaultVal: def.type === 'struct[]' ? (Array.isArray(def.default) ? def.default : []) : buildStructDefault(def.fields || {}),
                  ...(def.gizmo !== undefined && { gizmo: def.gizmo }),
                  ...attributes,
                });
                return;
              }
              // Array types: primitive or reference array (e.g. string[], number[], color[], boolean[], select[], asset[], entity[], or type: 'array')
              if (def.type === 'array' || (typeof def.type === 'string' && def.type.endsWith('[]'))) {
                const itemType = def.type === 'array'
                  ? (def.itemType || 'string')
                  : def.type.slice(0, -2);
                fields.push({
                  name,
                  type: def.type,
                  itemType,
                  ...(def.targetComponent !== undefined && { targetComponent: def.targetComponent }),
                  ...(def.assetType !== undefined && { assetType: def.assetType }),
                  ...(def.gizmo !== undefined && { gizmo: def.gizmo }),
                  label: def.label || name,
                  defaultVal: Array.isArray(def.default) ? def.default : [],
                  min: def.min,
                  max: def.max,
                  step: def.step,
                  options: def.options,
                  ...attributes,
                });
                return;
              }
              // Reference types: entity / asset — no default value (slot starts empty)
              const isRef = def.type === 'entity' || def.type === 'asset';
              fields.push({
                name,
                type: def.type || (typeof def.default === 'number' ? 'number' : typeof def.default === 'boolean' ? 'boolean' : 'string'),
                defaultVal: isRef ? null : (def.default ?? (def.type === 'number' ? 0 : def.type === 'boolean' ? false : '')),
                ...(def.targetComponent !== undefined && { targetComponent: def.targetComponent }),
                ...(def.assetType !== undefined && { assetType: def.assetType }),
                ...(def.gizmo !== undefined && { gizmo: def.gizmo }),
                min: def.min,
                max: def.max,
                step: def.step,
                options: def.options,
                label: def.label || name,
                ...attributes,
              });
            } else {
              // Direct value mapping: { speed: 2.5, color: '#ff0000' }
              const valType = typeof def === 'number' ? 'number' : typeof def === 'boolean' ? 'boolean' : 'string';
              fields.push({
                name,
                type: valType === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(def) ? 'color' : valType,
                defaultVal: def,
                label: name,
              });
            }
          });
        }
      } catch (evalErr) {
        // The props OBJECT could not be evaluated (a helper misuse, a syntax
        // error, a reference to something out of scope). The regex fallback
        // below then runs, which does not understand struct/select — record
        // it so the Inspector can warn instead of silently showing a wrong
        // or partial schema.
        warnings.push(
          `Props object could not be evaluated (${evalErr?.message || evalErr}); showing a basic text scan instead — struct/select props may be missing.`,
        );
      }
    }
 
    // 2. Regex fallback for inline public fields.
    // For reference types (entity/asset) there is no `default:` clause, so
    // we also handle the no-default form: `name: { type: 'entity', label: '…' }`
    // Note: struct/struct[] are not supported by the regex fallback path.
    if (fields.length === 0) {
      // With-default form: propName: { type: 'number', default: 10 }
      const fieldRegex = /(?:public\s+)?([A-Za-z0-9_]+)\s*:\s*\{\s*type:\s*['"]([A-Za-z0-9_]+)['"]\s*,\s*default:\s*([^,}]+)/g;
      let m;
      while ((m = fieldRegex.exec(code)) !== null) {
        const name = m[1];
        const type = m[2];
        let defaultVal = m[3].trim().replace(/^['"]|['"]$/g, '');
        if (type === 'number') defaultVal = parseFloat(defaultVal) || 0;
        if (type === 'boolean') defaultVal = defaultVal === 'true';
        fields.push({ name, type, defaultVal, label: name });
      }
      // No-default form for reference types: propName: { type: 'entity' } or type: 'asset'
      if (fields.length === 0) {
        const refRegex = /([A-Za-z0-9_]+)\s*:\s*\{\s*type:\s*['\"](entity|asset)['"]/g;
        while ((m = refRegex.exec(code)) !== null) {
          fields.push({ name: m[1], type: m[2], defaultVal: null, label: m[1] });
        }
      }
    }
  } catch (err) {
    console.warn('Prop extraction warning:', err);
  }
 
  cacheSet(propsSchemaCache, code, fields);
  cacheSet(propsWarningsCache, code, warnings);
  return fields;
}
 
/**
 * P1.5-adjacent fix — script "kind" auto-detection.
 *
 * Before this, the Inspector's "Add Component" popover dumped every saved
 * script into all three script-based sections (React Clips, Canvas
 * Components, Motion Scripts) unconditionally — `canvasScripts = scripts`
 * and the Motion Scripts list both used the full, unfiltered `scripts`
 * array, so a single file like `CustomClip.jsx` showed up in all three
 * lists regardless of which contract it actually implements. Picking the
 * "wrong" section for it produced a component that silently did nothing
 * (or errored) at render time, since the runtime contract it doesn't match
 * ignores the arguments it doesn't expect.
 *
 * This inspects the script body (not just the filename) and returns which
 * single contract it actually satisfies, so the Inspector can filter each
 * section down to scripts that will actually work there:
 *   - 'canvas' — has an onMount(...) method (the CanvasRenderer contract:
 *                onMount/onUpdate/onUnmount driven by { container, ... }).
 *   - 'motion' — has onStart/onUpdate written against a `transform` arg
 *                (the ScriptComponent contract) and no onMount.
 *   - 'react'  — returns JSX / React.createElement and isn't a class using
 *                the motion or canvas method names.
 *   - 'unknown' — code doesn't clearly match any contract yet (e.g. a
 *                 fresh empty script); shown everywhere so it isn't
 *                 hidden while being written.
 *
 * This is intentionally cheap regex sniffing (consistent with
 * extractScriptProps above), not a real parse — good enough to route the
 * "Add Component" UI, not a substitute for the runtime actually failing
 * clearly if a script is attached to the wrong component type.
 */
export function detectScriptKind(code) {
  if (!code || !code.trim()) return 'unknown';
  if (scriptKindCache.has(code)) {
    return scriptKindCache.get(code);
  }
 
  let kind = 'unknown';
 
  const hasOnMount = /\bonMount\s*\(/.test(code);
  const hasOnUnmount = /\bonUnmount\s*\(/.test(code);
  const hasContainerArg = /\{\s*[^}]*\bcontainer\b[^}]*\}\s*\)\s*\{/.test(code);

  // Scripts that extend CanvasComponent or ThreeComponent are always canvas-kind,
  // even if they don't declare their own onMount (they inherit it from the base class).
  const extendsCanvasClass = /\bextends\s+(CanvasComponent|ThreeComponent)\b/.test(code);
 
  const hasOnStartOrOnUpdate = /\bonStart\s*\(|\bonUpdate\s*\(/.test(code);
  const hasTransformArg = /\{\s*[^}]*\btransform\b[^}]*\}\s*\)\s*\{/.test(code);
 
  // JSX detection also covers the `h(tag, props, children)` helper form
  // (shorthand for React.createElement) — those still return
  // React.createElement calls at runtime, they just don't spell
  // "React.createElement" or "<div" in the source text.
  const returnsJsx =
    /return\s*\(?\s*</.test(code) ||
    /React\.createElement\s*\(/.test(code) ||
    /return\s*h\s*\(\s*['"]/.test(code);
  const isClass = /\bclass\s+[A-Za-z0-9_]+/.test(code);
 
  const isShader = /\bvec4\s+transition\s*\(|\bgl_FragColor\b/.test(code);
 
  if (isShader) {
    kind = 'shader';
  } else if (extendsCanvasClass || hasOnMount || hasOnUnmount || (hasContainerArg && !hasTransformArg)) {
    // CanvasRenderer contract: extends CanvasComponent/ThreeComponent, or
    // explicit onMount({ container, props }) / onUpdate({ container, ... }) / onUnmount(...)
    kind = 'canvas';
  } else if (hasOnStartOrOnUpdate && (hasTransformArg || !returnsJsx) && isClass) {
    // ScriptComponent (motion script) contract: onStart/onUpdate({ transform, tween, props })
    kind = 'motion';
  } else if (returnsJsx && !isClass) {
    // ReactRenderer contract: function component returning JSX
    kind = 'react';
  } else if (hasOnStartOrOnUpdate) {
    // Class with onStart/onUpdate but we couldn't confirm the transform arg
    // shape — still far more likely to be a motion script than anything else.
    kind = 'motion';
  }
 
  cacheSet(scriptKindCache, code, kind);
  return kind;
}
 
/**
 * Compiles a JS/JSX script into an executable module/class
 */
function runCompiledModule(transpiled, sourceName, scriptName = '') {
  // Only the legacy "React Component (no JSX)" authoring style calls a bare
  // `h(...)`. Only inject the React.createElement alias when the script
  // actually uses it AND doesn't already declare its own `h` — otherwise we
  // get "Identifier 'h' has already been declared" whenever a script imports
  // a third-party library that happens to bundle its own top-level `h` (a
  // very common short identifier: height locals, Preact-style hyperscript
  // helpers used internally by graph/layout libraries, etc.).
  const callsH = /\bh\s*\(/.test(transpiled);
  const declaresOwnH =
    /\b(?:const|let|var)\s+h\b/.test(transpiled) ||
    /\bfunction\s+h\s*\(/.test(transpiled) ||
    /\bimport\s*\{[^}]*\bh\b[^}]*\}/.test(transpiled);
  const needsHHelper = callsH && !declaresOwnH;

  // Module wrapper providing React, MotionTween, Easing, MathUtils, and Remotion hooks.
  //
  // Built as prefix + user code + suffix (instead of one template literal) so
  // the wrapper's exact line offset is known: the number of newlines in
  // `prefix` is how many lines sit above the user's code once the body is
  // handed to `new Function`. formatRuntimeError needs that number to turn a
  // stack line back into the line the author actually wrote.
  const prefix = `
    let exports = {};
    let module = { exports: {} };

    // Helper function to simulate default export
    function exportDefault(target) {
      module.exports.default = target;
      return target;
    }

    ${needsHHelper ? `// h(tag, props, children) -- no-JSX authoring helper injected because this
    // script calls h(...) and does not declare its own h.
    const h = React.createElement;` : ''}

    `;

  // `//# sourceURL=` gives every frame of this evaluated body a stable name
  // (`blahblah-script:MyScript.jsx`) — that marker is what lets a runtime stack
  // frame be recognised as a script frame, and what FIX 4 in scriptConsole.js
  // uses to forward only real script errors. The name is sanitised because it
  // is injected into the source text.
  const suffix = `

    // Resolve the exported entity.
    //
    // A script with no \`export default\` used to come back as esbuild's CJS
    // module object with no \`default\` and was treated as a valid module that
    // silently did nothing. It now fails loudly as a normal compile error
    // (Console entry + red Inspector badge + the editor's error box).
    const ownKeys = module.exports && typeof module.exports === 'object' ? Object.keys(module.exports) : [];
    const hasDefaultKey = ownKeys.includes('default');
    const defaultExport = hasDefaultKey ? module.exports.default : undefined;
    if (!hasDefaultKey) {
      if (ownKeys.length === 0) {
        throw new Error('Script has no default export. Add \`export default class MyScript { ... }\` (or a function for React scripts).');
      }
    } else if (
      defaultExport === undefined ||
      defaultExport === null ||
      (typeof defaultExport !== 'function' && typeof defaultExport !== 'object')
    ) {
      throw new Error('default export must be a class, function, or object');
    }

    const result = hasDefaultKey
      ? defaultExport
      : (module.exports || (typeof CustomComponent !== 'undefined' ? CustomComponent : null));
    return result;
  //# sourceURL=${scriptSourceURL(scriptName || sourceName)}
`;

  const moduleWrapper = prefix + transpiled + suffix;
  const wrapperLineOffset = prefix.split('\n').length - 1;
 
  let compiledFn;
  try {
    compiledFn = new Function(
    'React',
    'ReactDOM',
    'ReactDOMClient',
    'MotionTweenContext',
    'Easing',
    'Ease',
    'LoopType',
    'MathUtils',
    'interpolate',
    'spring',
    // The prop helpers, so `static props = { speed: num(2) }` — which the
    // class body evaluates the moment the class is defined — resolves here
    // exactly as it does in extractScriptProps' evaluator above. Same
    // mechanism as React/MathUtils: parameters of the wrapper, so they are
    // in scope for the whole script and never touch the real global object.
    ...PROP_HELPER_NAMES,
    moduleWrapper
    );
  } catch (err) {
    // A SyntaxError here means the compiled body itself is malformed; name
    // the script so the Console entry is actionable.
    if (sourceName && err instanceof SyntaxError && !String(err.message).includes(sourceName)) {
      err.message = `in ${sourceName}: ${err.message}`;
    }
    throw err;
  }

  const result = compiledFn(
    React,
    ReactDOM,
    ReactDOMClient,
    MotionTweenContext,
    Easing,
    Ease,
    LoopType,
    MathUtils,
    interpolate,
    spring,
    ...propHelperValues()
  );
  // The offset travels with the result so the caller can register the source
  // map keyed by this exact script code (see registerRuntimeMap).
  return { result, wrapperLineOffset };
}
 
/**
 * Last-resort synchronous compile with the REGEX transpiler.
 *
 * Only reached when esbuild failed to initialise (no wasm available): it is
 * the offline escape hatch, not the normal path. It is deliberately broken
 * for some inputs (nested-brace JSX, `a ? b : any`), which is why nothing
 * routes through it while esbuild is available.
 */
function compileWithRegex(scriptCode, scriptName) {
  try {
    const transpiled = transpileJsxToJs(scriptCode);
    // The regex path has no source map (esbuild is the only compiler that
    // produces one), so a runtime error here falls back to the raw stack.
    const { result: exportedResult } = runCompiledModule(transpiled, scriptName, scriptName);
    lastErrorCache.delete(scriptCode);
    lastErrorGeneration.delete(scriptCode);
    pendingBundleCache.delete(scriptCode);
    return cacheSet(compiledModuleCache, scriptCode, exportedResult);
  } catch (err) {
    // ── STRICT GATE ── compile failed → never execute, log structured error
    const msg = err instanceof SyntaxError
      ? `error: SyntaxError — ${err.message}\n note: Check for mismatched braces, missing semicolons, or invalid JSX`
      : `error: ${err.message}`;
    pendingBundleCache.delete(scriptCode);
    cacheSet(lastErrorCache, scriptCode, msg);
    cacheSet(lastErrorGeneration, scriptCode, getConsoleGeneration());
    pushCompileError(msg, scriptName);
    return null;
  }
}

/**
 * Compiles a JS/JSX script into an executable module/class. Always
 * synchronous — never awaits anything — because this is called from
 * inside React's useMemo (EntityRenderer) and the export render loop.
 *
 * EVERY script is compiled by esbuild on the async precompile path
 * (precompileWithBundler, triggered on project load / hot-reload / create /
 * save). Until that compile lands, the script is marked "pending" (the same
 * mechanism the import case used to use) and this returns null — the
 * Inspector shows "Compiling…", not an error, and never a regex-mangled
 * result. The regex transpiler runs ONLY if esbuild failed to initialise
 * AND its init promise has settled (esbuildReady === false), so the app
 * still works offline without wasm.
 */
export function compileScriptModule(scriptCode, scriptName) {
  if (!scriptCode) return null;
  if (compiledModuleCache.has(scriptCode)) {
    return compiledModuleCache.get(scriptCode);
  }

  // ── STRICT GATE ── if a previous compile recorded an error, never run.
  // Re-emit it once if the Console was cleared since it was last pushed, so
  // clearing the panel cannot permanently hide a real error.
  if (lastErrorCache.has(scriptCode)) {
    if (lastErrorGeneration.get(scriptCode) !== getConsoleGeneration()) {
      pushCompileError(lastErrorCache.get(scriptCode), scriptName);
      cacheSet(lastErrorGeneration, scriptCode, getConsoleGeneration());
    }
    return null;
  }

  // Still starting esbuild, or it is ready and this script simply has not
  // been compiled yet → pending. Never a false error, never the regex path.
  if (!esbuildInitSettled || esbuildReady) {
    pendingBundleCache.add(scriptCode);
    return null;
  }

  // esbuild could not initialise — degrade to the regex transpiler.
  return compileWithRegex(scriptCode, scriptName);
}

 
/**
 * Deterministically executes a behavior motion script for a GameObject transform
 */
export function executeScriptComponent({
  scriptCode,
  scriptName,
  transform,
  localTime = 0,
  clipDuration = 5,
  publicValues = {},
  frame = 0,
  fps = 30,
  allEntities = [],
  allAssets = [],
}) {
  if (!scriptCode) return transform;

  // Freeze guard: once a callback of THIS script has blown its budget twice,
  // skip it on every subsequent frame until the code changes (a new source
  // string) or resetScriptDisabled re-enables it, so a runaway script cannot
  // freeze the preview/export loop every single frame.
  if (isScriptDisabled(scriptCode)) return transform;

  try {
    const compiled = compileScriptModule(scriptCode, scriptName);
    if (!compiled) return transform;
 
    const tweenContext = new MotionTweenContext({ ...transform });
 
    // Transform proxy with vector-friendly sub-properties
    const transformProxy = {
      position: {
        x: transform.x ?? 0,
        y: transform.y ?? 0,
        _isPosition: true,
      },
      scale: {
        x: transform.scaleX ?? 1,
        y: transform.scaleY ?? 1,
        _isScale: true,
      },
      rotation: transform.rotation ?? 0,
      opacity: transform.opacity ?? 1,
    };
 
    const schema = extractScriptProps(scriptCode);
    const scriptProps = resolveScriptProps(publicValues, schema, allEntities, allAssets);
 
    // Instantiate class or run object methods
    let instance = null;
    if (typeof compiled === 'function' && compiled.prototype && compiled.prototype.constructor) {
      try {
        instance = new compiled();
      } catch {
        // Might be a functional component
        instance = null;
      }
    } else if (typeof compiled === 'object' && compiled !== null) {
      instance = compiled;
    }
 
    // 1. Call onStart() / Start() for tween setup
    const onStartFn = instance?.onStart || instance?.Start || compiled?.onStart;
    if (typeof onStartFn === 'function') {
      const startT0 = nowMs();
      onStartFn.call(instance, {
        transform: transformProxy,
        tween: tweenContext,
        props: scriptProps,
        time: localTime,
        frame,
        fps,
        duration: clipDuration,
        Math: MathUtils,
        Tween,
      });
      const startMs = nowMs() - startT0;
      if (startMs > getCallBudgetMs('onStart')) {
        markScriptSlow(scriptCode, scriptName, startMs, 'onStart');
        return transform;
      }
    }
 
    // 2. Deterministically evaluate tweens at localTime
    const tweenedTransform = tweenContext.evaluate(localTime, {
      x: transformProxy.position.x,
      y: transformProxy.position.y,
      rotation: transformProxy.rotation,
      scaleX: transformProxy.scale.x,
      scaleY: transformProxy.scale.y,
      opacity: transformProxy.opacity,
    });
 
    transformProxy.position.x = tweenedTransform.x;
    transformProxy.position.y = tweenedTransform.y;
    transformProxy.rotation = tweenedTransform.rotation;
    transformProxy.scale.x = tweenedTransform.scaleX;
    transformProxy.scale.y = tweenedTransform.scaleY;
    transformProxy.opacity = tweenedTransform.opacity;
 
    // 3. Call onUpdate() / Update() for custom frame-based math
    const onUpdateFn = instance?.onUpdate || instance?.Update || compiled?.onUpdate;
    if (typeof onUpdateFn === 'function') {
      const updateT0 = nowMs();
      onUpdateFn.call(instance, {
        transform: transformProxy,
        props: scriptProps,
        time: localTime,
        frame,
        fps,
        duration: clipDuration,
        Math: MathUtils,
        lerp: MathUtils.lerp,
        clamp: MathUtils.clamp,
        interpolate,
        spring,
        // onUpdate has no stateful MotionTweenContext. `tween` is the
        // stateless, generic helper shared by motion/canvas scripts.
        tween: Tween,
        Tween,
      });
      const updateMs = nowMs() - updateT0;
      if (updateMs > getCallBudgetMs('onUpdate')) {
        markScriptSlow(scriptCode, scriptName, updateMs, 'onUpdate');
        return transform;
      }
    }

    return {
      ...transform,
      x: transformProxy.position.x,
      y: transformProxy.position.y,
      rotation: transformProxy.rotation,
      scaleX: transformProxy.scale.x,
      scaleY: transformProxy.scale.y,
      opacity: Math.max(0, Math.min(1, transformProxy.opacity)),
    };
  } catch (err) {
    // Motion script errors used to be console.warn-only (invisible unless
    // devtools was open). Push them to the Console panel with the script name
    // and stack, and still fall back to the input transform so a broken
    // script cannot abort the whole preview/export frame.
    pushRuntimeError(
      formatRuntimeError(err, 'executeScriptComponent', scriptName),
      scriptName || 'script',
    );
    return transform;
  }
}

/**
 * Returns the compiled React Component for clips that render custom React / Web UI
 */
export function getCompiledReactComponent(scriptCode) {
  if (!scriptCode) return null;
  const compiled = compileScriptModule(scriptCode);
  if (typeof compiled === 'function') {
    return compiled;
  }
  return null;
}
 
/**
 * Check if a script has an active compilation error
 */
export function getScriptError(scriptCode) {
  return lastErrorCache.get(scriptCode) || null;
}
 