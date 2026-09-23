 
import React from 'react';
import ReactDOM from 'react-dom';
import ReactDOMClient from 'react-dom/client';
import * as esbuild from 'esbuild-wasm';
import { bundleScript } from './scriptBundler.js';
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
 
/**
 * Cache for compiled JavaScript/JSX modules to ensure 60fps performance without recompiling.
 */
const compiledModuleCache = new Map();
const propsSchemaCache = new Map();
const lastErrorCache = new Map();
const scriptKindCache = new Map();
 
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
 * captures a `from 'x'` / `import 'x'` specifier when it appears outside
 * them. (A regex pass has to strip strings to avoid false positives, but
 * stripping strings also destroys the very quotes the specifiers live in —
 * the first version of this function made that exact mistake.)
 */
export function extractImportSpecifiers(code) {
  if (!code) return [];
  const specs = [];
  const n = code.length;
 
  let i = 0;
  let quote = null; // ' " or ` when inside a string literal
  let lineComment = false;
  let blockComment = false;
  let sawImportKeyword = false; // last keyword was `import` (or `export`)
  let expectingFrom = false; // `from` seen after import/export — next quote is the specifier
 
  const isWordChar = (ch) => /[A-Za-z0-9_$]/.test(ch);
  const isIdentStart = (ch) => /[A-Za-z_$]/.test(ch);
 
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
 
    // The specifier quote: either right after `from` or immediately after
    // `import` (side-effect import: `import 'x'`). MUST run before the
    // generic string-start check below, or the opening quote gets consumed
    // as a string start and the specifier is never captured.
    if ((expectingFrom || sawImportKeyword) && (ch === '"' || ch === "'")) {
      const q = ch;
      let j = i + 1;
      while (j < n && code[j] !== q) j++;
      const spec = code.slice(i + 1, j);
      if (spec && !specs.includes(spec)) specs.push(spec);
      expectingFrom = false;
      sawImportKeyword = false;
      i = j + 1;
      continue;
    }
 
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i++;
      continue;
    }
 
    if (isIdentStart(ch)) {
      let j = i;
      while (j < n && isWordChar(code[j])) j++;
      const word = code.slice(i, j);
      if (word === 'import' || word === 'export') {
        sawImportKeyword = true;
        expectingFrom = false;
      } else if (sawImportKeyword && word === 'from') {
        expectingFrom = true;
      }
      // Any other identifier between import/export and the specifier
      // (module name, `type`, `default`, `{`, ...) — for `import 'x'`
      // side-effect imports the quote comes with NO intervening word, so
      // other words only matter for the `from` state handled above.
      i = j;
      continue;
    }
 
    if (ch === ';' || ch === '\n') {
      sawImportKeyword = false;
      expectingFrom = false;
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
 
function formatBundleError(err) {
  const esbuildError = err?.errors?.[0];
  if (esbuildError?.text) {
    const loc = esbuildError.location
      ? ` (line ${esbuildError.location.line}, column ${esbuildError.location.column})`
      : '';
    return `${esbuildError.text}${loc}`;
  }
  return err?.message || String(err);
}
 
/** Broadcast that some script finished bundling, so React re-renders. */
function notifyScriptsRecompiled() {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('blahblah:scripts-recompiled'));
  }
}
 
/**
 * Async, esbuild-bundled compile path for scripts that contain real
 * `import` statements. Resolves the full module graph (npm packages via
 * esm.sh once-then-cached, local scripts/ files, React shims), bundles to
 * one CJS string, evaluates it the same way compileScriptModule does, and
 * on success overwrites compiledModuleCache for this exact script string
 * so the next synchronous compileScriptModule call picks it up.
 *
 * On failure it records a real error in lastErrorCache (shown as the red
 * badge) and leaves any previously-compiled entry untouched. Safe to call
 * speculatively — it never blocks the render path.
 *
 * @param {string} scriptCode
 * @param {*} projectDirHandle File System Access handle for the project
 *   folder (scripts/ is resolved from it). May be null/undefined — the
 *   bundle will then fail on relative imports but still resolve packages.
 */
export async function precompileWithBundler(scriptCode, projectDirHandle) {
  if (!scriptCode) return;
  if (!hasImportStatements(scriptCode)) return; // regex path handles these
 
  await esbuildInitPromise;
  if (!esbuildReady) return;
 
  try {
    const bundled = await bundleScript(scriptCode, projectDirHandle);
    const exportedResult = runCompiledModule(toCommonJsExports(bundled));
    lastErrorCache.delete(scriptCode);
    pendingBundleCache.delete(scriptCode);
    compiledModuleCache.set(scriptCode, exportedResult);
    notifyScriptsRecompiled();
  } catch (err) {
    console.warn('Script bundling failed:', err);
    pendingBundleCache.delete(scriptCode);
    lastErrorCache.set(scriptCode, formatBundleError(err));
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
  const needsBundle = (s) =>
    !!s?.code && hasImportStatements(s.code) && !compiledModuleCache.has(s.code) && !pendingBundleCache.has(s.code);
  const toBundle = scripts.filter(needsBundle);
  if (toBundle.length === 0) return;
  await Promise.allSettled(toBundle.map((s) => precompileWithBundler(s.code, projectDirHandle)));
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

export function extractScriptProps(code) {
  if (!code) return [];
  if (propsSchemaCache.has(code)) {
    return propsSchemaCache.get(code);
  }
 
  const fields = [];
 
  try {
    // 1. Find `static props = { ... }` via a brace-counting scan that
    // correctly captures the FULL object even when it contains nested
    // objects (struct / struct[] fields) — see extractPropsObjectSource.
    const propsObjectSource = extractPropsObjectSource(code);
    if (propsObjectSource) {
      try {
        const schemaFunc = new Function(`return (${propsObjectSource});`);
        const schemaObj = schemaFunc();
        if (schemaObj && typeof schemaObj === 'object') {
          Object.entries(schemaObj).forEach(([name, def]) => {
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
      } catch {
        // Fallback to regex parser below
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
 
  propsSchemaCache.set(code, fields);
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
 
  scriptKindCache.set(code, kind);
  return kind;
}
 
/**
 * Compiles a JS/JSX script into an executable module/class
 */
function runCompiledModule(transpiled) {
  // Module wrapper providing React, MotionTween, Easing, MathUtils, and Remotion hooks
  const moduleWrapper = `
    let exports = {};
    let module = { exports: {} };
 
    // Helper function to simulate default export
    function exportDefault(target) {
      module.exports.default = target;
      return target;
    }
 
    // h(tag, props, children) -- no-JSX authoring helper. The Script
    // Editor's own placeholder text tells users to write h(tag, props,
    // children) for "React Component (no JSX)" templates instead of
    // angle-bracket JSX, so this must be provided at runtime or every
    // such script throws "h is not defined" the moment it renders.
    const h = React.createElement;
 
    ${transpiled}
 
    // Resolve exported entity
    const result = module.exports.default || module.exports || (typeof CustomComponent !== 'undefined' ? CustomComponent : null);
    return result;
  `;
 
  const compiledFn = new Function(
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
    moduleWrapper
  );
 
  return compiledFn(
    React,
    ReactDOM,
    ReactDOMClient,
    MotionTweenContext,
    Easing,
    Ease,
    LoopType,
    MathUtils,
    interpolate,
    spring
  );
}
 
/**
 * Compiles a JS/JSX script into an executable module/class. Always
 * synchronous — never awaits anything — because this is called from
 * inside React's useMemo (EntityRenderer) and the export render loop.
 *
 * Two paths:
 *  - Scripts WITHOUT import statements compile via the regex transpiler
 *    (`transpileJsxToJs`), exactly as always.
 *  - Scripts WITH import statements return null and are marked "pending"
 *    until `precompileWithBundler` (the async esbuild bundle, triggered on
 *    save / project load / hot-reload) lands and fills the cache — the
 *    regex transpiler would silently delete those imports and leave the
 *    script referencing undefined names, so it must not run on them.
 */
export function compileScriptModule(scriptCode) {
  if (!scriptCode) return null;
  if (compiledModuleCache.has(scriptCode)) {
    return compiledModuleCache.get(scriptCode);
  }
 
  if (hasImportStatements(scriptCode)) {
    // Mark pending only while there's no recorded error yet — a failed
    // bundle records a real error (red badge) and must NOT keep showing
    // the "Resolving imports…" state on every subsequent sync call.
    if (!lastErrorCache.has(scriptCode)) {
      pendingBundleCache.add(scriptCode);
    }
    return null;
  }
 
  try {
    const transpiled = transpileJsxToJs(scriptCode);
    const exportedResult = runCompiledModule(transpiled);
 
    lastErrorCache.delete(scriptCode);
    compiledModuleCache.set(scriptCode, exportedResult);
    return exportedResult;
  } catch (err) {
    console.warn('Script compilation error:', err);
    lastErrorCache.set(scriptCode, err.message);
    return null;
  }
}
 
/**
 * Deterministically executes a behavior motion script for a GameObject transform
 */
export function executeScriptComponent({
  scriptCode,
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
 
  try {
    const compiled = compileScriptModule(scriptCode);
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
    console.warn('Script execution warning:', err);
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
 