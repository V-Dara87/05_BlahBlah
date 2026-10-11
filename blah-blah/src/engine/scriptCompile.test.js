import test from 'node:test';
import assert from 'node:assert/strict';

import {
  precompileWithBundler,
  compileScriptModule,
  getCompiledReactComponent,
  getScriptError,
  isScriptBundlePending,
  getScriptPropsWarnings,
  isScriptDisabled,
  resetScriptDisabled,
  markScriptSlow,
  getCallBudgetMs,
  executeScriptComponent,
  extractImportSpecifiers,
  hasImportStatements,
} from './scriptRunner.js';
import {
  pushRuntimeError,
  getConsoleEntries,
  clearConsole,
  installGlobalScriptErrorHandlers,
} from './scriptConsole.js';

/** The 1-based line of `code` that contains `needle` (0 when absent). */
function lineOf(code, needle) {
  return code.split('\n').findIndex((l) => l.includes(needle)) + 1;
}

// Every script — with or without imports — is compiled by esbuild on the
// async precompile path; compileScriptModule is "pending" until that lands.
// These tests warm the cache first, exactly as the app does on load/save.
async function compile(code, name = 'Test.jsx') {
  return precompileWithBundler(code, null, name);
}

// ─── Fake File System Access handles (for the real-import case) ─────────────

function makeNotFound() {
  return Object.assign(new Error('not found'), { name: 'NotFoundError' });
}

function makeFakeScriptsDir(files) {
  const fileHandleFor = (name) => ({
    name,
    async getFile() {
      return { text: async () => files.get(name) };
    },
  });
  return {
    name: 'scripts',
    async getFileHandle(name) {
      if (files.has(name)) return fileHandleFor(name);
      throw makeNotFound();
    },
    async getDirectoryHandle(name) {
      const prefix = `${name}/`;
      const paths = Array.from(files.keys()).filter((p) => p.startsWith(prefix));
      if (paths.length > 0) {
        return makeFakeScriptsDir(
          new Map(paths.map((p) => [p.slice(prefix.length), files.get(p)])),
        );
      }
      throw makeNotFound();
    },
  };
}

function makeFakeProjectHandle(scriptsFiles) {
  const scriptsDir = makeFakeScriptsDir(scriptsFiles);
  return {
    name: 'fake-project',
    async getDirectoryHandle(name) {
      if (name === 'scripts') return scriptsDir;
      throw makeNotFound();
    },
  };
}

/** Instantiate a compiled class module and run its onMount. */
function instantiate(compiled) {
  const instance = typeof compiled === 'function' && compiled.prototype ? new compiled() : compiled;
  instance?.onMount?.({ container: {} });
  return instance;
}

// ===========================================================================
// 1. The regex transpiler's three bugs, on the esbuild path
// ===========================================================================

test('nested-brace JSX (style={{ … }}) compiles and renders via React.createElement', async () => {
  const code = `
    export default function RedLabel() {
      return <div style={{ color: 'red' }}>hi</div>;
    }
  `;
  const result = await compile(code, 'RedLabel.jsx');
  assert.equal(result.ok, true, `compile failed: ${result.error}`);

  const Component = getCompiledReactComponent(code);
  assert.equal(typeof Component, 'function');
  const el = Component({});
  assert.equal(el.type, 'div');
  assert.deepEqual(el.props.style, { color: 'red' });
  // createElement(type, props, children) — the text child is the third arg.
  assert.equal(el.props.children, 'hi');
});

test('a ternary whose alternate is named `any` is preserved', async () => {
  // The old regex deleted `: any`, leaving `const x = a ? b ;` (a SyntaxError).
  const code = `
    function pick(a, b, any) { const x = a ? b : any; return x; }
    export default class TernaryProbe {
      onMount() { this.value = pick(true, 7, 9); }
    }
  `;
  const result = await compile(code, 'TernaryProbe.jsx');
  assert.equal(result.ok, true, `compile failed: ${result.error}`);
  const instance = instantiate(compileScriptModule(code));
  assert.equal(instance.value, 7, 'a ? b : any must evaluate, not be deleted');
});

test('the string "Count: number" is preserved verbatim', async () => {
  const code = `
    export default class LabelProbe {
      onMount() { this.label = "Count: number"; }
    }
  `;
  const result = await compile(code, 'LabelProbe.jsx');
  assert.equal(result.ok, true, `compile failed: ${result.error}`);
  const instance = instantiate(compileScriptModule(code));
  assert.equal(instance.label, 'Count: number');
});

// ===========================================================================
// 2. JSX features the regex transpiler also could not handle
// ===========================================================================

test('fragments, .map() lists, and conditional rendering all compile', async () => {
  const code = `
    export default function List({ items }) {
      return (
        <>
          {items.map((i) => <li key={i}>{i}</li>)}
          {items.length ? <b>yes</b> : null}
        </>
      );
    }
  `;
  const result = await compile(code, 'List.jsx');
  assert.equal(result.ok, true, `compile failed: ${result.error}`);

  const Component = getCompiledReactComponent(code);
  const el = Component({ items: [1, 2] });
  // React.Fragment with two children: the mapped array and the conditional.
  assert.equal(el.props.children.length, 2);
  const [list, conditional] = el.props.children;
  assert.equal(list.length, 2);
  assert.equal(list[0].type, 'li');
  assert.equal(list[0].props.children, 1);
  assert.equal(conditional.type, 'b');
});

test('TypeScript interfaces and annotations are stripped', async () => {
  const code = `
    interface Props { value: number }
    type Label = string;
    const offset: number = 3;
    export default function Show({ value }: Props): JSX.Element {
      const text: Label = String(value + offset);
      return <span>{text}</span>;
    }
  `;
  const result = await compile(code, 'Show.jsx');
  assert.equal(result.ok, true, `compile failed: ${result.error}`);
  const Component = getCompiledReactComponent(code);
  const el = Component({ value: 4 });
  assert.equal(el.props.children, '7');
});

// ===========================================================================
// 3. Scripts with real imports still bundle
// ===========================================================================

test('scripts with import statements still bundle (relative + offline)', async () => {
  const project = makeFakeProjectHandle(
    new Map([['helper.js', 'export function double(x) { return x * 2; }']]),
  );
  const code = `
    import { double } from './helper.js';
    export default class ImportProbe {
      onMount() { this.doubled = double(21); }
    }
  `;
  const result = await precompileWithBundler(code, project, 'ImportProbe.jsx');
  assert.equal(result.ok, true, `compile failed: ${result.error}`);
  assert.equal(isScriptBundlePending(code), false);
  assert.equal(getScriptError(code), null);
  const instance = instantiate(compileScriptModule(code));
  assert.equal(instance.doubled, 42);
});

test('a syntax error becomes a real Console error, not a silent pending', async () => {
  const code = 'export default class Broken { onMount( { }';
  const result = await compile(code, 'Broken.jsx');
  assert.equal(result.ok, false);
  assert.ok(result.error, 'expected an error message');
  assert.equal(isScriptBundlePending(code), false);
  assert.ok(getScriptError(code), 'getScriptError should report it');
  assert.equal(compileScriptModule(code), null, 'broken code must never execute');
});

// ===========================================================================
// 3b. Freeze guard (FIX 1: per-method budgets, two strikes, re-enable)
// ===========================================================================

/** A motion script whose onUpdate burns ~600ms (over the 500ms frame budget). */
const SLOW_MOTION = `
export default class SlowMotion {
  onUpdate({ transform }) {
    const end = Date.now() + 600;
    while (Date.now() < end) { /* busy */ }
    transform.position.x = 123;
  }
}
`;

const TRANSFORM_IN = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };

function runMotion(code, name, localTime = 0) {
  return executeScriptComponent({
    scriptCode: code, scriptName: name, transform: { ...TRANSFORM_IN },
    localTime, frame: Math.round(localTime * 30), fps: 30,
  });
}

test('freeze guard forgives one slow frame and disables on the second', async () => {
  const code = SLOW_MOTION;
  await compile(code, 'SlowMotion.jsx');
  clearConsole();

  const first = runMotion(code, 'SlowMotion.jsx');
  assert.equal(isScriptDisabled(code), false, 'a single slow frame must be forgiven');
  assert.equal(first.x, 0, 'the slow frame still falls back to the input transform');

  const second = runMotion(code, 'SlowMotion.jsx', 0.1);
  assert.equal(isScriptDisabled(code), true, 'the second over-budget call must disable it');
  assert.equal(second.x, 0);

  // The user is told how to get the script back.
  const entry = getConsoleEntries().find((e) => /Script paused:/.test(e.message));
  assert.ok(entry, `expected a pause message, got ${JSON.stringify(getConsoleEntries())}`);
  assert.match(entry.message, /Press Re-enable in the Inspector, or edit the code and save/);

  // Skipped from now on, so the freeze cannot recur every frame.
  const third = runMotion(code, 'SlowMotion.jsx', 0.2);
  assert.equal(third.x, 0, 'a disabled script must not run again');

  resetScriptDisabled(code);
});

test('resetScriptDisabled re-enables the script and clears its strikes', async () => {
  const code = SLOW_MOTION;
  await compile(code, 'SlowMotion.jsx');

  runMotion(code, 'SlowMotion.jsx');
  runMotion(code, 'SlowMotion.jsx', 0.1);
  assert.equal(isScriptDisabled(code), true);

  resetScriptDisabled(code);
  assert.equal(isScriptDisabled(code), false, 'resetScriptDisabled must clear the pause');

  // The counter was reset too: one more slow call is again forgiven, rather
  // than instantly re-disabling the script.
  runMotion(code, 'SlowMotion.jsx', 0.2);
  assert.equal(isScriptDisabled(code), false, 'a single slow call after a reset is forgiven');

  resetScriptDisabled(code);
});

test('freeze guard budgets are per method: onMount gets 5s, per-frame work 500ms', () => {
  // One-time setup (scene creation, first shader compile, asset load) is
  // allowed to take seconds; a per-frame hook is budgeted at 500ms. The
  // callers compare against these (see executeScriptComponent/safeCall), so a
  // single 500ms budget for everything would pause healthy scripts.
  assert.equal(getCallBudgetMs('onMount'), 5000);
  assert.equal(getCallBudgetMs('onContainerReattach'), 5000);
  assert.equal(getCallBudgetMs('onStart'), 500);
  assert.equal(getCallBudgetMs('onUpdate'), 500);
  assert.equal(getCallBudgetMs('onSeek'), 500);
  assert.equal(getCallBudgetMs('aFutureHook'), 500, 'unknown hooks use the per-frame budget');
});

test('strikes are counted per method, so two different slow methods are forgiven', () => {
  const code = 'export default class StrikeProbe {}';
  markScriptSlow(code, 'StrikeProbe.jsx', 600, 'onStart');
  markScriptSlow(code, 'StrikeProbe.jsx', 600, 'onUpdate');
  assert.equal(isScriptDisabled(code), false, 'one strike each is not two of the SAME method');

  markScriptSlow(code, 'StrikeProbe.jsx', 600, 'onUpdate');
  assert.equal(isScriptDisabled(code), true, 'the second onUpdate strike disables it');

  resetScriptDisabled(code);
});

// ===========================================================================
// 3c. Runtime errors point at the user's own line (FIX 3)
// ===========================================================================

test('a runtime error reports the original line with a caret', async () => {
  const code = [
    'export default class Boom {',
    '  onUpdate({ transform }) {',
    '    transform.position.x = 1;',
    "    throw new Error('kaboom');",
    '  }',
    '}',
  ].join('\n');
  const throwLine = lineOf(code, 'kaboom');
  assert.equal(throwLine, 4);

  const result = await compile(code, 'Boom.jsx');
  assert.equal(result.ok, true, `compile failed: ${result.error}`);
  clearConsole();

  runMotion(code, 'Boom.jsx');

  const entry = getConsoleEntries().find((e) => e.message.includes('kaboom'));
  assert.ok(entry, `the throw must reach the Console: ${JSON.stringify(getConsoleEntries())}`);
  assert.ok(
    entry.message.includes(`--> Boom.jsx:${throwLine}:`),
    `expected "--> Boom.jsx:${throwLine}:" in:\n${entry.message}`,
  );
  assert.ok(entry.message.includes("throw new Error('kaboom')"), 'the source line is shown');
  assert.ok(entry.message.includes('^'), 'a caret marks the column');
});

test('line mapping survives JSX that collapses earlier lines', async () => {
  const code = [
    'export default class ShapeBoom {',
    '  onUpdate({ transform }) {',
    '    const el = (',
    '      <div',
    '        className="box"',
    '        style={{ color: "red" }}',
    '      >',
    '        hello',
    '      </div>',
    '    );',
    "    throw new Error('jsx-line-shift');",
    '  }',
    '}',
  ].join('\n');
  const throwLine = lineOf(code, 'jsx-line-shift');

  const result = await compile(code, 'ShapeBoom.jsx');
  assert.equal(result.ok, true, `compile failed: ${result.error}`);
  clearConsole();

  runMotion(code, 'ShapeBoom.jsx');

  const entry = getConsoleEntries().find((e) => e.message.includes('jsx-line-shift'));
  assert.ok(entry, `the throw must reach the Console: ${JSON.stringify(getConsoleEntries())}`);
  assert.ok(
    entry.message.includes(`--> ShapeBoom.jsx:${throwLine}:`),
    `expected "--> ShapeBoom.jsx:${throwLine}:" (the multi-line JSX is folded into one\n` +
      `generated line, so the raw stack line is different) in:\n${entry.message}`,
  );
});

test('line mapping survives stripped TypeScript annotations', async () => {
  const code = [
    'interface Options { speed: number }',
    'type Label = string;',
    'export default class TsBoom {',
    '  onUpdate({ transform }: { transform: any }) {',
    '    const speed: number = 5;',
    "    throw new Error('ts-boom' + speed);",
    '  }',
    '}',
  ].join('\n');
  const throwLine = lineOf(code, 'ts-boom');

  const result = await compile(code, 'TsBoom.jsx');
  assert.equal(result.ok, true, `compile failed: ${result.error}`);
  clearConsole();

  runMotion(code, 'TsBoom.jsx');

  const entry = getConsoleEntries().find((e) => e.message.includes('ts-boom'));
  assert.ok(entry, `the throw must reach the Console: ${JSON.stringify(getConsoleEntries())}`);
  assert.ok(
    entry.message.includes(`--> TsBoom.jsx:${throwLine}:`),
    `expected "--> TsBoom.jsx:${throwLine}:" (the interface/type lines are stripped, so the\n` +
      `raw stack line is different) in:\n${entry.message}`,
  );
});

// ===========================================================================
// 3d. Async error attribution is strict (FIX 4)
// ===========================================================================

/**
 * Run `fn` with a minimal fake `window` whose listeners are collected, so the
 * global handlers can be exercised with fake events (there is no DOM in the
 * node test runner).
 */
function withFakeWindow(fn) {
  const listeners = new Map();
  const fakeWindow = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
  };
  const hadWindow = 'window' in globalThis;
  const previous = globalThis.window;
  globalThis.window = fakeWindow;
  const dispose = installGlobalScriptErrorHandlers();
  const fire = (type, event) => {
    for (const handler of listeners.get(type) || []) handler(event);
  };
  try {
    fn(fire);
  } finally {
    dispose();
    if (hadWindow) globalThis.window = previous;
    else delete globalThis.window;
  }
}

test('async errors: a blahblah-script frame is forwarded with that script name', () => {
  clearConsole();
  const err = new Error('async boom');
  err.stack = 'Error: async boom\n    at onMount (blahblah-script:Async.jsx:7:3)';

  withFakeWindow((fire) => fire('unhandledrejection', { reason: err }));

  const entries = getConsoleEntries();
  assert.equal(entries.length, 1, JSON.stringify(entries));
  assert.equal(entries[0].scriptName, 'Async.jsx');
  assert.match(entries[0].message, /Unhandled promise rejection/);
});

test('async errors: unrelated stacks are ignored, not blamed on a script', () => {
  clearConsole();
  withFakeWindow((fire) => {
    // A browser/dockview style stack with the frames that used to match.
    fire('error', {
      message: 'dockview exploded',
      filename: 'blob:http://localhost/abc-def',
    });
    const anon = new Error('<anonymous> failure');
    anon.stack = 'Error: nope\n    at <anonymous>:1:1\n    at new Function (<anonymous>)';
    fire('unhandledrejection', { reason: anon });
    // A Tauri/plugin rejection with no script frame at all.
    fire('unhandledrejection', { reason: new Error('ipc failed') });
  });

  assert.deepEqual(getConsoleEntries(), []);
});

// ===========================================================================
// 3e. A script with no usable default export fails loudly (FIX 5)
// ===========================================================================

test('a script without a default export is a clear compile error', async () => {
  const code = 'function helper() { return 1; }';
  const result = await compile(code, 'NoDefault.jsx');
  assert.equal(result.ok, false);
  assert.match(result.error, /Script has no default export/);
  assert.match(result.error, /export default class MyScript/);
  assert.equal(compileScriptModule(code), null, 'it must not execute as an empty module');
});

test('a default export that is neither a function nor an object is rejected', async () => {
  const scalar = await compile("export default 'hello';", 'BadDefault.jsx');
  assert.equal(scalar.ok, false);
  assert.match(scalar.error, /default export must be a class, function, or object/);

  const nothing = await compile('export default null;', 'NullDefault.jsx');
  assert.equal(nothing.ok, false);
  assert.match(nothing.error, /default export must be a class, function, or object/);
});

test('named-only exports stay a valid object module (no false default-export error)', async () => {
  const code = "export const NAME = 'hello';";
  const result = await compile(code, 'NamedOnly.jsx');
  assert.equal(result.ok, true, `compile failed: ${result.error}`);
  assert.deepEqual(extractImportSpecifiers(code), [], 'the string is data, not an import');
});

// ===========================================================================
// 3f. Import detection does not fire on export declarations (FIX 7)
// ===========================================================================

test('extractImportSpecifiers: export declarations are not imports', () => {
  assert.deepEqual(extractImportSpecifiers("export default function A(){ return 'x'; }"), []);
  assert.deepEqual(extractImportSpecifiers("export const NAME = 'hello';"), []);
  assert.deepEqual(extractImportSpecifiers("export default class A { label = 'hi'; }"), []);
  assert.deepEqual(extractImportSpecifiers("export default { name: 'x' };"), []);
  assert.deepEqual(extractImportSpecifiers('export function fmt(){ return 1; }'), []);
  assert.deepEqual(extractImportSpecifiers('import.meta.url'), []);
});

test('extractImportSpecifiers: real import forms still work', () => {
  assert.deepEqual(extractImportSpecifiers("import('three')"), ['three']);
  assert.deepEqual(extractImportSpecifiers("import( 'four' )"), ['four']);
  assert.deepEqual(extractImportSpecifiers("import 'side-effect'"), ['side-effect']);
  assert.deepEqual(extractImportSpecifiers("export { double } from './helpers.js';"), ['./helpers.js']);
  assert.deepEqual(extractImportSpecifiers("export * from './all.js';"), ['./all.js']);
  assert.deepEqual(extractImportSpecifiers("export { a } from 'x'"), ['x']);
  // Multi-line import clauses resolve their `from` across lines and comments.
  assert.deepEqual(extractImportSpecifiers("import {\n  a,\n  b\n} from 'x';\n"), ['x']);
  assert.deepEqual(extractImportSpecifiers("import /* why */ 'x';"), ['x']);
  assert.deepEqual(extractImportSpecifiers("import type { X } from 'y';"), ['y']);
  assert.deepEqual(extractImportSpecifiers("import gsap from 'gsap';"), ['gsap']);
});

test('extractImportSpecifiers: comments, strings and templates cannot fake an import', () => {
  assert.deepEqual(
    extractImportSpecifiers("// import x from 'nope'\nconst s = \"from 'nope2'\";"),
    [],
  );
  assert.deepEqual(extractImportSpecifiers("const t = `import a from 'nope3'`;"), []);
  assert.deepEqual(
    extractImportSpecifiers("const o = { from: 'nope4' };\nobj.from('nope5');"),
    [],
  );
});

test('a one-line export default script compiles offline instead of hitting the bundler', async () => {
  const code = "export default function A(){ return 'x'; }";
  assert.equal(hasImportStatements(code), false, 'export ... is not an import');

  // No project handle at all: before FIX 7 this was reported as a missing
  // package named 'x' by the import bundler.
  const result = await compile(code, 'OneLiner.jsx');
  assert.equal(result.ok, true, `compile failed: ${result.error}`);
  assert.equal(typeof getCompiledReactComponent(code), 'function');
});

test('a props-only script still compiles with a clean schema (no import detour)', async () => {
  const code = `export default class PropsProbe {
    static props = { speed: { type: 'number', default: 2 } };
    onUpdate() {}
  }`;
  const result = await compile(code, 'PropsProbe.jsx');
  assert.equal(result.ok, true, `compile failed: ${result.error}`);
  assert.deepEqual(getScriptPropsWarnings(code), []);
});

// ===========================================================================
// 4. Console dedupe (Task 2c)
// ===========================================================================

test('identical consecutive console entries collapse and increment count', () => {
  clearConsole();
  pushRuntimeError('same bug every frame', 'Canvas.jsx');
  pushRuntimeError('same bug every frame', 'Canvas.jsx');
  pushRuntimeError('same bug every frame', 'Canvas.jsx');

  let entries = getConsoleEntries();
  assert.equal(entries.length, 1, 'three identical pushes → one entry');
  assert.equal(entries[0].count, 3);
  assert.equal(entries[0].message, 'same bug every frame');

  // A different message is NOT merged with the previous one.
  pushRuntimeError('a different bug', 'Canvas.jsx');
  entries = getConsoleEntries();
  assert.equal(entries.length, 2);
  assert.equal(entries[1].count, 1);
});

test('a still-broken script re-emits its compile error once after clearConsole()', async () => {
  const code = 'export default class ReEmit { onMount( { }';
  await compile(code, 'ReEmit.jsx');
  assert.ok(getScriptError(code), 'expected a recorded compile error');

  clearConsole();
  assert.equal(getConsoleEntries().length, 0);

  // "Used again" after the clear → the error is surfaced once more.
  assert.equal(compileScriptModule(code, 'ReEmit.jsx'), null);
  const afterReemit = getConsoleEntries();
  assert.equal(afterReemit.length, 1);
  assert.equal(afterReemit[0].severity, 'compile-error');
  assert.equal(afterReemit[0].scriptName, 'ReEmit.jsx');

  // A second call in the same generation does NOT duplicate it.
  compileScriptModule(code, 'ReEmit.jsx');
  assert.equal(getConsoleEntries().length, 1);
});

// ===========================================================================
// 5. Props validation warnings (Task 4)
// ===========================================================================

test('props warnings: unknown type', () => {
  const warnings = getScriptPropsWarnings("static props = { speed: { type: 'numbr', default: 1 } };");
  assert.ok(warnings.some((w) => /unknown prop type 'numbr'/.test(w)), warnings.join('\n'));
});

test('props warnings: min greater than max', () => {
  const warnings = getScriptPropsWarnings(
    "static props = { speed: { type: 'number', default: 5, min: 10, max: 2 } };",
  );
  assert.ok(warnings.some((w) => /min \(10\) is greater than max \(2\)/.test(w)), warnings.join('\n'));
});

test('props warnings: select without options', () => {
  const warnings = getScriptPropsWarnings("static props = { mode: { type: 'select', default: 'a' } };");
  assert.ok(warnings.some((w) => /no options array/.test(w)), warnings.join('\n'));
});

test('props warnings: default outside [min, max]', () => {
  const warnings = getScriptPropsWarnings(
    "static props = { speed: { type: 'number', default: 99, min: 0, max: 10 } };",
  );
  assert.ok(warnings.some((w) => /above max \(10\)/.test(w)), warnings.join('\n'));
});

test('props warnings: struct without fields', () => {
  const warnings = getScriptPropsWarnings("static props = { group: { type: 'struct' } };");
  assert.ok(warnings.some((w) => /no `fields` sub-schema/.test(w)), warnings.join('\n'));
});

test('props warnings: button with no matching method (and a clean button)', () => {
  const bad = getScriptPropsWarnings(
    "export default class A { static props = { go: { type: 'button', action: 'bake' } }; }",
  );
  assert.ok(bad.some((w) => /no such method/.test(w)), bad.join('\n'));

  const good = getScriptPropsWarnings(
    "export default class A { static props = { go: { type: 'button', action: 'bake' } }; bake() {} }",
  );
  assert.equal(good.length, 0, good.join('\n'));
});

test('props warnings: an unevaluatable props object is reported, never thrown', () => {
  const warnings = getScriptPropsWarnings("static props = { n: notAHelper(3) };");
  assert.ok(warnings.some((w) => /could not be evaluated/.test(w)), warnings.join('\n'));
});

test('props warnings: a clean schema produces no warnings', () => {
  const warnings = getScriptPropsWarnings(`
    static props = {
      speed: num(2, { min: 0, max: 10 }),
      mode: select('a', ['a', 'b']),
      tint: color('#ff0000'),
    };
  `);
  assert.deepEqual(warnings, []);
});
