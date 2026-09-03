/**
 * The real bundler for user scripts that use `import` — esbuild-wasm's
 * `build()` (not `transform()`) with a custom resolution plugin, so a
 * module graph (npm packages, local script files, React shims) is actually
 * resolved and inlined into ONE CommonJS-style bundle string that the
 * existing `runCompiledModule` eval wrapper can execute.
 *
 * Resolution rules (all handled in the plugin, so `resolveDir` is
 * irrelevant and every path is namespaced):
 *   - bare specifiers (`three`, `gsap@^3`, `animejs`)  -> packageResolver
 *     (esm.sh fetch once, IndexedDB cache forever; offline after first use)
 *   - relative specifiers (`./helpers.js`)             -> project scripts/
 *     folder via the File System Access API (never network-dependent)
 *   - esm.sh internal chunk paths (`/three@0.185.1/...`) -> fetched + cached
 *     recursively, so a package's own import graph is fully offline-reusable
 *   - `react` / `react-dom` / `react/jsx-runtime` (+ their esm.sh paths)
 *     -> virtual shims over the app's OWN React instance, injected into the
 *     eval scope — one React, never a second copy (ARCHITECTURE.md)
 *   - node builtins (`fs`, `path`, ...)                -> clear error
 *   - anything else (full URLs)                        -> left external
 *
 * JSX in scripts is compiled with the CLASSIC transform (jsxFactory
 * React.createElement) so the output calls the injected React global
 * directly — no separate react/jsx-runtime module needed on the entry path
 * (the runtime shim still exists for packages that import it internally).
 */

import * as esbuild from 'esbuild-wasm';
import { readScriptFile } from './scriptFileReader.js';
import {
  isBareSpecifier,
  parseEsmPath,
  resolvePackageImport,
  resolveEsmShChunk,
} from './packageResolver.js';

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls',
  'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads',
  'zlib',
]);

export function isNodeBuiltin(spec) {
  if (spec.startsWith('node:')) return true;
  return NODE_BUILTINS.has(spec);
}

/**
 * Which React shim a specifier needs, or null if it's not React-family.
 * Handles bare specifiers AND esm.sh's absolute react paths (peer
 * dependencies stay external in esm.sh output, e.g. framer-motion's
 * `import "/react@^18.0.0%20||%20^19.0.0?target=es2022"`).
 */
export function reactFamilyKind(spec) {
  if (spec === 'react') return 'react';
  if (spec === 'react/jsx-runtime' || spec === 'react/jsx-dev-runtime') return 'jsx-runtime';
  if (spec === 'react-dom') return 'react-dom';
  if (spec === 'react-dom/client' || spec === 'react-dom/server') return 'react-dom-client';
  if (spec.startsWith('/')) {
    const parsed = parseEsmPath(spec);
    if (parsed && (parsed.name === 'react' || parsed.name === 'react-dom')) {
      const sub = parsed.rest.split('?')[0];
      if (sub.includes('jsx-runtime') || sub.includes('jsx-dev-runtime')) return 'jsx-runtime';
      if (parsed.name === 'react-dom' && sub.includes('client')) return 'react-dom-client';
      return parsed.name === 'react' ? 'react' : 'react-dom';
    }
  }
  return null;
}

/**
 * Virtual module bodies for React-family imports. These run INSIDE the
 * bundle, which itself runs inside runCompiledModule's `new Function(...)`
 * — so the free identifiers `React` / `ReactDOM` resolve to the app's own
 * injected instances. Each shim is a fresh wrapper object (never mutates
 * the real React/ReactDOM) exposing `default` + named exports + the
 * `__esModule` flag esbuild's CJS interop checks.
 */
export function reactShimContents(kind) {
  switch (kind) {
    case 'react-dom':
      // React 19 removed createRoot from 'react-dom' proper — it lives in
      // 'react-dom/client' (the react-dom-client shim below). Keeping this
      // shim a faithful copy of ReactDOM means `import { flushSync } from
      // 'react-dom'` works and `createRoot` resolves from the right module.
      return [
        'const __d = Object.assign({}, ReactDOM);',
        '__d.default = ReactDOM;',
        '__d.__esModule = true;',
        'module.exports = __d;',
      ].join('\n');
    case 'react-dom-client':
      return [
        'const __c = Object.assign({}, ReactDOMClient);',
        '__c.default = ReactDOMClient;',
        '__c.__esModule = true;',
        'module.exports = __c;',
      ].join('\n');
    case 'jsx-runtime':
      return [
        'const __j = (type, props, key) => React.createElement(type, { ...(props || {}), key });',
        'module.exports = { jsx: __j, jsxs: __j, jsxDEV: __j, Fragment: React.Fragment, __esModule: true };',
      ].join('\n');
    case 'react':
    default:
      return [
        'const __r = Object.assign({}, React);',
        '__r.default = React;',
        '__r.__esModule = true;',
        'module.exports = __r;',
      ].join('\n');
  }
}

/**
 * esbuild plugin implementing the resolution rules in the header comment.
 * `dirHandle` must be the project's `scripts/` folder (see bundleScript).
 */
export function createImportPlugin(dirHandle) {
  return {
    name: 'blahblah-imports',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const { path } = args;

        const reactKind = reactFamilyKind(path);
        if (reactKind) {
          return { path, namespace: 'blahblah-react', pluginData: { kind: reactKind } };
        }
        if (isNodeBuiltin(path)) {
          return {
            errors: [
              { text: `Node.js built-in module "${path}" is not available in the browser. This script cannot run in blahblah.` },
            ],
          };
        }
        if (path.startsWith('/')) {
          // esm.sh internal chunk path (e.g. /three@0.185.1/es2022/three.mjs)
          return { path, namespace: 'blahblah-esmsh' };
        }
        if (path.startsWith('.')) {
          return { path, namespace: 'blahblah-file' };
        }
        if (isBareSpecifier(path)) {
          return { path, namespace: 'blahblah-pkg' };
        }
        // Full URLs / anything else: leave external (degrades to a clear
        // eval-time error rather than a silent wrong render).
        return null;
      });

      build.onLoad({ filter: /.*/, namespace: 'blahblah-react' }, (args) => ({
        loader: 'js',
        contents: reactShimContents(args.pluginData?.kind || 'react'),
      }));

      build.onLoad({ filter: /.*/, namespace: 'blahblah-esmsh' }, async (args) => ({
        loader: 'js',
        contents: await resolveEsmShChunk(args.path),
      }));

      build.onLoad({ filter: /.*/, namespace: 'blahblah-file' }, async (args) => {
        const found = await readScriptFile(dirHandle, args.path);
        if (!found) {
          return {
            errors: [
              {
                text: `Could not resolve relative import "${args.path}" — tried .js/.jsx/.ts/.tsx and /index.* inside the project's scripts/ folder.`,
              },
            ],
          };
        }
        return { loader: 'tsx', contents: found.code };
      });

      build.onLoad({ filter: /.*/, namespace: 'blahblah-pkg' }, async (args) => {
        const resolved = await resolvePackageImport(args.path);
        return { loader: 'js', contents: resolved.sourceText };
      });
    },
  };
}

/** The project folder's scripts/ dir, falling back to the handle itself. */
async function resolveScriptsDir(projectDirHandle) {
  if (!projectDirHandle) return null;
  try {
    return await projectDirHandle.getDirectoryHandle('scripts', { create: false });
  } catch {
    return projectDirHandle; // handle already IS a scripts/ dir (tests, etc.)
  }
}

/**
 * Bundle `scriptCode` (which must contain at least one static import) into
 * a single CJS-style string ready for runCompiledModule. Throws on any
 * resolution/parse failure — callers record the error message.
 */
export async function bundleScript(scriptCode, projectDirHandle) {
  const scriptsDir = await resolveScriptsDir(projectDirHandle);

  const result = await esbuild.build({
    stdin: {
      contents: scriptCode,
      sourcefile: 'entry.jsx',
      resolveDir: '.',
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    minify: false,
    logLevel: 'silent',
    plugins: [createImportPlugin(scriptsDir)],
  });

  return result.outputFiles[0].text;
}