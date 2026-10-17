/**
 * Guard rails for user scripts.
 *
 * IMPORTANT — what this is and is not. Scripts run on the app's main thread
 * (see scriptRunner.js), so this is NOT a security boundary: a determined
 * script can still reach the real globals (`document.defaultView`,
 * `(() => {}).constructor`, …). A real boundary needs a Worker or a separate
 * JS engine. What this file DOES do is stop the accidents and the obvious
 * abuse, with a clear message instead of silent misbehaviour:
 *
 *   - scripts cannot read or write the app's storage (localStorage,
 *     sessionStorage, indexedDB, caches);
 *   - scripts cannot open sockets (WebSocket, EventSource, …) or use XHR;
 *   - scripts cannot reach the Tauri bridge (`__TAURI__`, `__TAURI_INTERNALS__`,
 *     the `ipc:` scheme), which is what would turn "a script in a project file"
 *     into "code that can touch the user's disk";
 *   - `fetch` still works (fonts, images and libraries need it) but refuses
 *     `ipc:` / `file:` targets.
 *
 * Everything is driven by the two lists below, so loosening or tightening the
 * policy is a one-line change.
 *
 * Mechanism: the names are bound as PARAMETERS of the script's wrapper
 * function (the same way `React` and the prop helpers are), so a bare
 * `localStorage` resolves to the guard instead of the real object, and
 * `window` / `globalThis` / `self` resolve to a Proxy over the real global
 * that applies the same rules.
 */

/** Bare names (and `window.<name>` properties) a script may not use. */
export const BLOCKED_GLOBALS = Object.freeze([
  // Persistent storage belongs to the app, not to a project's scripts.
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'cookieStore',
  // Raw network channels. (`fetch` is allowed, see guardedFetch below.)
  'XMLHttpRequest',
  'WebSocket',
  'WebTransport',
  'EventSource',
  'RTCPeerConnection',
  // The desktop shell's bridge to the user's files and OS.
  '__TAURI__',
  '__TAURI_INTERNALS__',
  '__TAURI_IPC__',
  '__TAURI_METADATA__',
  '__TAURI_EVENT_PLUGIN_INTERNALS__',
  '__TAURI_OS_PLUGIN_INTERNALS__',
]);

/** Names that mean "the global object"; each resolves to the guarded proxy. */
const GLOBAL_ALIASES = Object.freeze(['window', 'globalThis', 'self', 'top', 'parent', 'frames']);

const BLOCKED_SET = new Set(BLOCKED_GLOBALS);
const ALIAS_SET = new Set(GLOBAL_ALIASES);

/** A clear, catchable error for a blocked API. */
export class ScriptSandboxError extends Error {
  constructor(name) {
    super(
      `"${name}" is blocked in scripts. Scripts run inside the editor and may not touch app storage, sockets or the desktop bridge. ` +
        'Keep script state in plain variables or in the Inspector props.',
    );
    this.name = 'ScriptSandboxError';
  }
}

/** An object that throws a ScriptSandboxError on any use. */
function blockedStub(name) {
  const fail = () => {
    throw new ScriptSandboxError(name);
  };
  return new Proxy(function blocked() {}, {
    get: (_t, key) => (key === Symbol.toPrimitive || key === 'toString' ? () => `[blocked ${name}]` : fail()),
    set: fail,
    has: fail,
    apply: fail,
    construct: fail,
    deleteProperty: fail,
    defineProperty: fail,
  });
}

/** True when `input` points at the desktop bridge or the local disk. */
function isForbiddenFetchTarget(input, base) {
  let raw;
  try {
    raw = typeof input === 'string' ? input : input && typeof input.url === 'string' ? input.url : String(input);
    const url = new URL(raw, base || 'http://localhost/');
    if (url.protocol === 'ipc:' || url.protocol === 'file:') return true;
    // Tauri v2 on Windows/Android serves its IPC over http://ipc.localhost
    if (url.hostname === 'ipc.localhost') return true;
    return false;
  } catch {
    return false; // let fetch itself report a malformed URL
  }
}

function makeGuardedFetch(realGlobal) {
  return function guardedFetch(input, init) {
    const base = realGlobal.location && realGlobal.location.href;
    if (isForbiddenFetchTarget(input, base)) {
      return Promise.reject(
        new ScriptSandboxError('fetch to ipc:/file: targets'),
      );
    }
    if (typeof realGlobal.fetch !== 'function') {
      return Promise.reject(new TypeError('fetch is not available in this environment'));
    }
    return realGlobal.fetch(input, init);
  };
}

/**
 * A Proxy over the real global object that applies BLOCKED_GLOBALS, routes
 * `fetch` through the guard and keeps `window.window === window`.
 *
 * Native methods (`requestAnimationFrame`, `setTimeout`, …) throw
 * "Illegal invocation" when called with the Proxy as `this`, so plain
 * functions are returned bound to the real global. Constructors and classes
 * (anything with a `prototype`: `Image`, `AudioContext`, `URL`, …) are
 * returned untouched so `new`, `instanceof` and static members keep working.
 */
export function createGuardedGlobal(realGlobal = globalThis) {
  const guardedFetch = makeGuardedFetch(realGlobal);
  const boundCache = new WeakMap();


  const bind = (fn) => {
    let bound = boundCache.get(fn);
    if (!bound) {
      bound = fn.bind(realGlobal);
      boundCache.set(fn, bound);
    }
    return bound;
  };

  const proxy = new Proxy(realGlobal, {
    get(target, key) {
      if (typeof key === 'string') {
        if (BLOCKED_SET.has(key)) throw new ScriptSandboxError(key);
        if (ALIAS_SET.has(key)) return proxy;
        if (key === 'fetch') return guardedFetch;
      }
      const value = Reflect.get(target, key, target);
      if (typeof value === 'function' && !('prototype' in value)) return bind(value);
      return value;
    },
    set(target, key, value) {
      if (typeof key === 'string' && BLOCKED_SET.has(key)) throw new ScriptSandboxError(key);
      return Reflect.set(target, key, value, target);
    },
    has(target, key) {
      if (typeof key === 'string' && BLOCKED_SET.has(key)) {
        // `'x' in window` feature checks should see "absent" — but a Proxy may
        // not hide a non-configurable own property, so that case stays true.
        const desc = Reflect.getOwnPropertyDescriptor(target, key);
        return desc ? desc.configurable === false : false;
      }
      return Reflect.has(target, key);
    },
    deleteProperty(target, key) {
      if (typeof key === 'string' && BLOCKED_SET.has(key)) throw new ScriptSandboxError(key);
      return Reflect.deleteProperty(target, key);
    },
  });
  return proxy;
}

let cached = null;

/**
 * The names + values the evaluator binds as wrapper parameters, in matching
 * order. Built once: the guarded global is the same object for every script.
 */
export function getSandboxScope() {
  if (cached) return cached;
  const realGlobal = typeof window !== 'undefined' ? window : globalThis;
  const guarded = createGuardedGlobal(realGlobal);
  const names = [...GLOBAL_ALIASES, 'fetch', ...BLOCKED_GLOBALS];
  const values = [
    ...GLOBAL_ALIASES.map(() => guarded),
    guarded.fetch,
    ...BLOCKED_GLOBALS.map((n) => blockedStub(n)),
  ];
  cached = { names, values };
  return cached;
}

// ─── lifecycle-name typo check ───────────────────────────────────────────────

/** Hooks the runtime actually calls on a script instance. */
export const LIFECYCLE_METHODS = Object.freeze([
  'onMount',
  'onUpdate',
  'onSeek',
  'onUnmount',
  'onStart',
  'onContainerReattach',
  'onGizmoDrag',
]);

const GIZMO_GETTER = 'getGizmos';

function editDistanceIsOne(a, b) {
  if (a === b) return false;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    // one substitution, or two adjacent letters swapped ("onUpdaet")
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  if (la > lb) return a.slice(i + 1) === b.slice(i); // one extra char in a
  return b.slice(i + 1) === a.slice(i); // one extra char in b
}

/**
 * A hook that is misspelled is never called, and the script then "does
 * nothing" with no error — the worst kind of bug to hunt. Returns the first
 * suspicious method name with the hook it was probably meant to be, or null.
 *
 * Only names that start with `on` (any case) are compared to the hooks, and a
 * name that IS a hook is always fine, so ordinary helper methods are never
 * flagged.
 */
export function findLifecycleTypo(names) {
  for (const name of names) {
    if (name === 'constructor' || LIFECYCLE_METHODS.includes(name) || name === GIZMO_GETTER) continue;
    if (/^on/i.test(name)) {
      for (const hook of LIFECYCLE_METHODS) {
        if (name.toLowerCase() === hook.toLowerCase() || editDistanceIsOne(name, hook)) {
          return { name, suggestion: hook };
        }
      }
    }
    if (name.toLowerCase() === GIZMO_GETTER.toLowerCase()) {
      return { name, suggestion: GIZMO_GETTER };
    }
  }
  return null;
}

/**
 * Throw if a script's class (or object) has a method that looks like a
 * misspelled hook. A thrown error here becomes a normal compile error: the
 * script never runs, the Console and the Inspector badge say why.
 */
export function assertNoLifecycleTypos(exported) {
  let names = [];
  if (typeof exported === 'function' && exported.prototype) {
    names = Object.getOwnPropertyNames(exported.prototype);
  } else if (exported && typeof exported === 'object') {
    names = Object.keys(exported);
  }
  const typo = findLifecycleTypo(names);
  if (typo) {
    throw new Error(
      `Unknown method '${typo.name}' — did you mean '${typo.suggestion}'? ` +
        'Hook names are case-sensitive and a misspelled hook is never called.',
    );
  }
}