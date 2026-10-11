/**
 * The real bundler for user scripts that use `import` — esbuild-wasm's
 * `build()` (not `transform()`) with a custom resolution plugin, so a
 * module graph (npm packages, local script files, React shims) is actually
 * resolved and inlined into ONE CommonJS-style bundle string that the
 * existing `runCompiledModule` eval wrapper can execute.
 *
 * Resolution rules (all handled in the plugin, so `resolveDir` is
 * irrelevant and every path is namespaced):
 *   - `@blahblah/sdk` (+ any subpath under it)         -> virtual module,
 *     served from this file's own bundled copy of packages/blahblah-sdk's
 *     runtime (see BLAHBLAH_SDK_SOURCE below) — never hits esm.sh or the
 *     project's scripts/ folder, so it works offline and identically no
 *     matter where the project lives on disk.
 *   - bare specifiers (`three`, `gsap@^3`, `animejs`)  -> packageResolver
 *     (esm.sh fetch once, IndexedDB cache forever; offline after first use)
 *   - relative specifiers from the USER'S ENTRY SCRIPT (`./helpers.js`)
 *     -> project scripts/ folder via the File System Access API (never
 *     network-dependent)
 *   - relative specifiers from INSIDE an esm.sh-served module (e.g.
 *     FontLoader.js's own `../../../three.mjs`) -> resolved against that
 *     module's own esm.sh URL and fetched/cached as an esm.sh chunk, NOT
 *     treated as a local project file. This is the one case that isn't a
 *     plain "path starts with '.'" check — a relative import only means
 *     "look in scripts/" when the file doing the importing is the user's
 *     own script or another local file; a relative import from a fetched
 *     esm.sh module is that module's own internal dependency graph and
 *     must resolve back to esm.sh instead. We track this via each loaded
 *     module's own resolved path/namespace and resolve child imports
 *     relative to it in onResolve using esbuild's `importer` argument.
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
// Raw text of the SDK's runtime — bundled at build time via Vite's `?raw`
// import so the bundler's virtual module always matches whatever is
// actually in packages/blahblah-sdk/index.js, same rationale as
// projectFileSystem.js's `?raw` import of index.d.ts (no separate copy to
// keep in sync by hand). This is the RUNTIME (behavior); index.d.ts is the
// separate types-only file projectFileSystem.js vendors into each project.
import blahblahSdkSource from '../../packages/blahblah-sdk/index.js?raw';

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
 * Whether a specifier refers to the SDK's virtual module — `@blahblah/sdk`
 * itself, or any subpath under it (e.g. a hypothetical `@blahblah/sdk/foo`).
 * Matched before the bare-specifier / esm.sh checks below so it never
 * falls through to packageResolver or a network fetch.
 */
export function isBlahblahSdkSpecifier(spec) {
  return spec === '@blahblah/sdk' || spec.startsWith('@blahblah/sdk/');
}

/**
 * The prop-declaration helpers as an importable module.
 *
 * `import { num, Presets } from 'blahblah'` — the helpers are GLOBALS by
 * default (scriptRunner.js injects them into both execution paths), so this
 * exists for scripts that prefer an explicit import, and for editors/type
 * tooling that want the names written down. Matched on the exact bare
 * specifier only: a real npm package named `blahblah` must not be shadowed by
 * a prefix match, and no subpath is offered because this module has one flat
 * export surface.
 */
export const PROP_HELPERS_SPECIFIER = 'blahblah';

/** Whether a specifier asks for the prop-declaration helpers. */
export function isPropHelpersSpecifier(spec) {
  return spec === PROP_HELPERS_SPECIFIER;
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
 * Virtual module body for `import { num, Presets } from 'blahblah'`.
 *
 * Deliberately NOT the helpers module's raw text: the bundled code already runs
 * inside runCompiledModule's `new Function(...)`, where the helpers are injected
 * as parameters. Exporting those very identifiers (the same trick the React
 * shims below use for `React`) means an explicit import and the injected global
 * are the same object by construction — they cannot drift, and there is no
 * second copy of the module to keep in sync.
 *
 * It also avoids `?raw`: that suffix is a bundler-only convention, so under a
 * plain Node runner the import binds the MODULE rather than its source text,
 * which is exactly how the first version of this broke.
 */
export function propHelperShimContents() {
  return [
    'const __helpers = { num, bool, color, text, select, asset, entity, font, button, group, row, Presets };',
    'module.exports = __helpers;',
    'module.exports.default = __helpers;',
    'module.exports.__esModule = true;',
  ].join('\n');
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
 * Resolve a relative specifier (e.g. '../../../three.mjs' or './chunk.mjs')
 * against an esm.sh absolute base path (e.g.
 * '/three@0.160.0/examples/jsm/loaders/FontLoader.js'), the same way a
 * browser resolves a relative URL against a base URL — but working on
 * plain path strings since esm.sh chunk paths are already absolute
 * (leading '/'), not full https:// URLs.
 *
 * '/a/b/c.js' + '../d.js'    -> '/a/d.js'
 * '/a/b/c.js' + './d.js'     -> '/a/b/d.js'
 * '/a/b/c.js' + '../../d.js' -> '/d.js'
 */
export function resolveEsmShRelativePath(basePath, relativeSpec) {
  const baseDir = basePath.slice(0, basePath.lastIndexOf('/'));
  const baseParts = baseDir.split('/').filter(Boolean);
  const relParts = relativeSpec.split('/');

  for (const part of relParts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      baseParts.pop();
    } else {
      baseParts.push(part);
    }
  }

  return `/${baseParts.join('/')}`;
}

/**
 * esbuild plugin implementing the resolution rules in the header comment.
 * `dirHandle` must be the project's `scripts/` folder (see bundleScript).
 *
 * Tracks which esm.sh absolute path each `blahblah-esmsh`/`blahblah-pkg`
 * module was loaded from (keyed by the synthetic path esbuild uses to
 * identify that module — see the `path` returned from each onResolve
 * branch below), so a RELATIVE import found inside one of those modules
 * (e.g. FontLoader.js's own `../../../three.mjs`) can be resolved against
 * that module's own esm.sh location instead of being treated as a request
 * to look inside the user's local scripts/ folder. A relative import is
 * only ever a "look in scripts/" request when it comes from the user's
 * own entry script or another local file — never when it comes from a
 * package fetched off esm.sh.
 */
export function createImportPlugin(dirHandle) {
  // path (as esbuild sees it, i.e. the `path` we returned from onResolve
  // for that module) -> the esm.sh absolute chunk path it was loaded from.
  const esmShOrigins = new Map();

  return {
    name: 'blahblah-imports',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        const { path, importer } = args;

        if (isBlahblahSdkSpecifier(path)) {
          return { path, namespace: 'blahblah-sdk' };
        }

        // The same helpers the engine injects as globals, as an explicit
        // import. Checked before the bare-specifier branch below, which would
        // otherwise try to fetch a package literally named `blahblah`.
        if (isPropHelpersSpecifier(path)) {
          return { path, namespace: 'blahblah-props' };
        }

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
          esmShOrigins.set(path, path);
          return { path, namespace: 'blahblah-esmsh' };
        }
        if (path.startsWith('.')) {
          // A relative import — but WHO is importing it decides what it
          // means. If the importer is itself a module we loaded from
          // esm.sh (tracked in esmShOrigins), this relative path is that
          // package's own internal dependency graph and must resolve back
          // to esm.sh, not to the user's local scripts/ folder.
          const importerOrigin = esmShOrigins.get(importer);
          if (importerOrigin) {
            const resolvedPath = resolveEsmShRelativePath(importerOrigin, path);
            esmShOrigins.set(resolvedPath, resolvedPath);
            return { path: resolvedPath, namespace: 'blahblah-esmsh' };
          }
          return { path, namespace: 'blahblah-file' };
        }
        if (isBareSpecifier(path)) {
          return { path, namespace: 'blahblah-pkg' };
        }
        // Full URLs / anything else: leave external (degrades to a clear
        // eval-time error rather than a silent wrong render).
        return null;
      });

      // @blahblah/sdk resolves to the SDK's own source (vendored via
      // Vite's `?raw` import above) — never esm.sh, never the project's
      // scripts/ folder — so `import { CanvasComponent } from
      // '@blahblah/sdk'` works offline and identically regardless of
      // where the project directory lives on disk.
      build.onLoad({ filter: /.*/, namespace: 'blahblah-sdk' }, () => ({
        loader: 'js',
        contents: blahblahSdkSource,
      }));

      // The prop helpers, re-exported from the injected globals.
      build.onLoad({ filter: /.*/, namespace: 'blahblah-props' }, () => ({
        loader: 'js',
        contents: propHelperShimContents(),
      }));

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
        // Record where this package's own top-level module physically
        // lives on esm.sh (its cache key doubles as its resolvable path,
        // e.g. 'three@0.160.0/examples/jsm/loaders/FontLoader.js'), so
        // any relative import INSIDE this module's source (caught by the
        // onResolve branch above) can be resolved against it instead of
        // the user's local scripts/ folder.
        esmShOrigins.set(args.path, `/${resolved.key}`);
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
 * Shared compiler options. Both the bundler (below) and the import-free
 * transform use the CLASSIC JSX transform (jsxFactory React.createElement)
 * and output CJS, with `sourcefile` set to the script's own name so esbuild's
 * structured errors read `MyScript.jsx:12:5` rather than `entry.jsx:12:5`.
 *
 * The source map is EXTERNAL (`sourcemap: true` for transform, `'external'`
 * for build) and returned alongside the code — it is NOT embedded inline.
 * scriptRunner parses it and keeps it in a small per-script cache, so a
 * runtime stack frame can be mapped back to the user's own line without
 * bloating the evaluated string with a base64 blob.
 */
function compileOptions(sourcefile) {
  return {
    loader: 'tsx',
    format: 'cjs',
    target: 'es2020',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    sourcemap: true,
    sourcefile: sourcefile || 'entry.jsx',
  };
}

/**
 * Compile an import-free script (JSX + TypeScript stripped) to a CJS-style
 * string. `transform` (not `build`) is enough when there is nothing to
 * resolve, and it stays entirely offline. Throws on parse errors — callers
 * record the message.
 *
 * @returns {Promise<{ code: string, map: string|null }>}
 */
export async function transformScript(scriptCode, scriptName) {
  const result = await esbuild.transform(scriptCode, compileOptions(scriptName));
  return { code: result.code, map: result.map || null };
}

/**
 * Bundle `scriptCode` (which may contain static imports) into a single
 * CJS-style string ready for runCompiledModule. Throws on any
 * resolution/parse failure — callers record the error message.
 *
 * `write: false` means esbuild hands back outputFiles instead of writing to
 * disk; an EXTERNAL source map requires an `outfile` even then, so one is
 * set and the resulting `.map` output file is returned separately. The
 * `//# sourceMappingURL=` comment esbuild appends is stripped: the map never
 * lives next to the evaluated string, so leaving a dangling pointer would be
 * misleading.
 *
 * @returns {Promise<{ code: string, map: string|null }>}
 */
export async function bundleScript(scriptCode, projectDirHandle, scriptName) {
  const scriptsDir = await resolveScriptsDir(projectDirHandle);
  const opts = compileOptions(scriptName);

  const result = await esbuild.build({
    stdin: {
      contents: scriptCode,
      sourcefile: opts.sourcefile,
      resolveDir: '.',
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: opts.format,
    platform: 'browser',
    target: opts.target,
    // External maps must have a path; write:false keeps everything in memory.
    outfile: 'bundle.js',
    jsx: opts.jsx,
    jsxFactory: opts.jsxFactory,
    jsxFragment: opts.jsxFragment,
    sourcemap: 'external',
    minify: false,
    logLevel: 'silent',
    plugins: [createImportPlugin(scriptsDir)],
  });

  const jsFile = result.outputFiles.find((f) => !f.path.endsWith('.map'));
  const mapFile = result.outputFiles.find((f) => f.path.endsWith('.map'));
  const code = (jsFile?.text || '').replace(/\n?\/\/# sourceMappingURL=.*\s*$/, '');
  return { code, map: mapFile?.text || null };
}