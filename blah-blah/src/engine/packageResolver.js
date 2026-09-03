/**
 * npm package resolution for real `import` statements in user scripts.
 *
 * Sources every package from esm.sh (a CDN that serves npm packages as
 * ESM) via `fetch()` — NOT a <script> tag — so the response body can be
 * captured and written into the persistent IndexedDB cache (moduleCache.js)
 * before being handed to esbuild. Once a package+version is cached, the
 * network is never touched again for it: esm.sh is purely a first-fetch
 * bootstrap, no different in kind from what canvasRunner.js already does
 * with its CDN <script> tags for THREE/gsap, just generalized and
 * offline-durable.
 *
 * Version pinning: the first time a bare `import 'three'` is seen, it is
 * resolved against esm.sh once (which redirects/responds with a concrete
 * resolved version, e.g. three@0.185.1), that version is recorded as the
 * package's pin, and every later bare import of `three` reuses the pinned
 * version + cached bytes — stable across sessions, and fully offline after
 * the first fetch. Explicitly versioned imports (`three@0.160.0`) fetch
 * that exact version but do NOT change the pin.
 */

import {
  initModuleCache,
  getCachedModuleSource,
  putCachedModuleSource,
  hasCachedModuleSource,
  getPinnedPackageVersion,
  pinPackageVersion,
} from './moduleCache.js';

const ESM_SH_BASE = 'https://esm.sh';

/** True for specifiers that name an npm package (not relative / URL / absolute path). */
export function isBareSpecifier(spec) {
  if (!spec) return false;
  if (spec.startsWith('.')) return false; // ./x ../x
  if (spec.startsWith('/')) return false; // esm.sh internal chunk paths (/three@0.185.1/...)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec)) return false; // https:, node:, data:, ...
  return true;
}

/**
 * Parse an npm specifier into { name, versionPart, subpath }.
 *   'three'                          -> { name: 'three', versionPart: null, subpath: '' }
 *   'three@0.160.0'                  -> { name: 'three', versionPart: '0.160.0', subpath: '' }
 *   'three@^0.160/examples/...'      -> { name: 'three', versionPart: '^0.160', subpath: 'examples/...' }
 *   '@scope/pkg'                     -> { name: '@scope/pkg', versionPart: null, subpath: '' }
 *   '@scope/pkg@1.2.3'               -> { name: '@scope/pkg', versionPart: '1.2.3', subpath: '' }
 */
export function splitPackageSpecifier(spec) {
  let name;
  let rest;
  if (spec.startsWith('@')) {
    // Scoped: '@scope/pkg' or '@scope/pkg@1.2.3' or '@scope/pkg/subpath'
    const secondAt = spec.indexOf('@', 1);
    const slash = spec.indexOf('/');
    if (secondAt !== -1 && (slash === -1 || secondAt < slash)) {
      name = spec.slice(0, secondAt);
      rest = spec.slice(secondAt + 1);
    } else {
      // '@scope/pkg/subpath' — no version marker before the first slash
      const firstSlash = spec.indexOf('/');
      if (firstSlash === -1) {
        name = spec;
        rest = '';
      } else {
        name = spec.slice(0, firstSlash);
        rest = spec.slice(firstSlash + 1);
      }
    }
  } else {
    const at = spec.indexOf('@');
    if (at === -1) {
      name = spec;
      rest = '';
    } else {
      name = spec.slice(0, at);
      rest = spec.slice(at + 1);
    }
  }

  // rest is either a version ('0.160.0'), a subpath ('examples/x.js'), or
  // 'version/subpath'. Versions can contain '.', '-', '^', '~', '>', '<',
  // '=', '|', '%', ' ' (ranges), so find the split by the first '/'.
  let versionPart = null;
  let subpath = '';
  if (rest) {
    const slash = rest.indexOf('/');
    if (slash === -1) {
      versionPart = rest;
    } else {
      versionPart = rest.slice(0, slash);
      subpath = rest.slice(slash + 1);
    }
  }

  return { name, versionPart, subpath };
}

/**
 * Extract { name, version } from an esm.sh URL path like
 * '/three@0.185.1/es2022/three.mjs' or '/@scope/pkg@1.2.3/x.mjs'.
 * Uses a greedy name match so the LAST '@' before the first '/' wins.
 */
export function parseEsmPath(path) {
  const m = path.match(/^\/(.+)@([^/]+)(\/.*)?$/);
  if (!m) return null;
  return { name: m[1], version: m[2], rest: m[3] || '' };
}

/** Extract the resolved `name@version` from an esm.sh response's X-Esm-Path header. */
function resolvedVersionFromResponse(res) {
  const esmPath = res.headers.get('x-esm-path');
  if (esmPath) {
    const parsed = parseEsmPath(esmPath);
    if (parsed) return `${parsed.name}@${parsed.version}`;
  }
  return null;
}

/** Fallback: parse the `/* esm.sh - three@0.185.1 *\/` comment from the body. */
function versionFromBody(bodyText) {
  const m = bodyText.match(/\/\*\s*esm\.sh\s*-\s*(@?[^@\s/]+(?:[^@\s/]*))@([^\s*]+)\s*\*\//);
  if (m) return `${m[1]}@${m[2]}`;
  return null;
}

/**
 * Fetch a package entry (or explicit-version entry) from esm.sh, cache the
 * source under `${name}@${resolvedVersion}`, and (for versionless bare
 * imports) record the resolved version as the package's pin.
 *
 * Returns { sourceText, key, name, version, subpath }.
 * Throws with a human-readable message when the fetch fails.
 */
export async function resolvePackageImport(specifier) {
  await initModuleCache();

  const { name, versionPart, subpath } = splitPackageSpecifier(specifier);

  if (!versionPart && !subpath) {
    // Bare import: reuse the pinned version if we already have it cached.
    const pinned = getPinnedPackageVersion(name);
    if (pinned && hasCachedModuleSource(`${name}@${pinned}`)) {
      const sourceText = await getCachedModuleSource(`${name}@${pinned}`);
      return { sourceText, key: `${name}@${pinned}`, name, version: pinned, subpath: '' };
    }
  }

  // Compose the fetch URL. Entries get ?bundle so esm.sh inlines the
  // package's own dependency graph into one file; subpath files (and the
  // absolute chunk paths esm.sh modules import from each other) are fetched
  // as-is and recursively resolved by scriptBundler's plugin.
  const versionPath = versionPart ? `@${versionPart}` : '';
  const url =
    subpath
      ? `${ESM_SH_BASE}/${name}${versionPath}/${subpath}`
      : `${ESM_SH_BASE}/${name}${versionPath}?bundle`;

  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/javascript' } });
  } catch (err) {
    throw new Error(`Could not fetch package "${specifier}" from esm.sh — check your network connection. (${err.message})`);
  }
  if (!res.ok) {
    throw new Error(`Could not fetch package "${specifier}" from esm.sh — HTTP ${res.status}${res.status === 404 ? ' (package not found?)' : ''}.`);
  }

  const sourceText = await res.text();

  // Resolve the concrete version (header first, then body comment).
  let resolvedVersion = null;
  const fromHeader = resolvedVersionFromResponse(res);
  if (fromHeader) {
    resolvedVersion = fromHeader;
  } else {
    const fromBody = versionFromBody(sourceText);
    if (fromBody) resolvedVersion = fromBody;
  }
  if (!resolvedVersion) {
    // Last resort: whatever was asked for (with ranges, esm.sh already
    // resolved them in the body comment/header in practice).
    resolvedVersion = versionPart || `${name}@latest`;
  }
  if (!resolvedVersion.startsWith(`${name}@`)) {
    resolvedVersion = `${name}@${resolvedVersion}`;
  }

  const key = subpath ? `${resolvedVersion}/${subpath}` : resolvedVersion;
  await putCachedModuleSource(key, sourceText);

  // Only versionless bare imports move the pin — an explicit version is a
  // deliberate one-off, not a redefinition of what 'three' means.
  if (!versionPart && !subpath) {
    await pinPackageVersion(name, resolvedVersion.slice(name.length + 1));
  }

  return { sourceText, key, name, version: resolvedVersion, subpath };
}

/**
 * Fetch + cache an esm.sh internal chunk path (e.g.
 * '/three@0.185.1/es2022/three.mjs' or the ?bundle variant). Returns the
 * module source text. The path itself is the cache key, so the whole
 * module graph becomes offline-reusable after one resolution.
 */
export async function resolveEsmShChunk(path) {
  await initModuleCache();
  if (hasCachedModuleSource(path)) {
    return getCachedModuleSource(path);
  }
  let res;
  try {
    res = await fetch(`${ESM_SH_BASE}${path}`, { headers: { accept: 'application/javascript' } });
  } catch (err) {
    throw new Error(`Could not fetch esm.sh module "${path}" — check your network connection. (${err.message})`);
  }
  if (!res.ok) {
    throw new Error(`Could not fetch esm.sh module "${path}" — HTTP ${res.status}.`);
  }
  const sourceText = await res.text();
  await putCachedModuleSource(path, sourceText);
  return sourceText;
}