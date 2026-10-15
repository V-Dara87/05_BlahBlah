/**
 * Pure helpers for the Shared Library (no React, no storage, no DOM) so they
 * can be unit-tested with plain `node`.
 *
 *   - baseName / hashText         name + content identity
 *   - relativeImports / collectDeps   which sibling scripts a script needs
 *   - getScriptSyncStatus         is a project script behind / ahead of the library?
 */

/** "Arrow.jsx" and "arrow" count as the same name. */
export const baseName = (n) =>
  String(n || '').replace(/\.(jsx?|tsx?|mjs)$/i, '').trim().toLowerCase();

/** Small, fast, non-cryptographic content hash (FNV-1a 32-bit, hex). */
export function hashText(text) {
  const s = String(text ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Relative imports ("./Foo", "../Bar") found in a script's source. */
export function relativeImports(code) {
  const re = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  return [...new Set([...String(code || '').matchAll(re)].map((m) => m[1]))];
}

const SCRIPT_EXT = /\.(jsx?|tsx?|mjs)$/i;

/**
 * Every project script that `script` needs (directly or through other
 * scripts), plus the imports that could not be found.
 *
 * Scripts live flat in the project's scripts/ folder on disk, so an import is
 * matched by its last path segment ("../utils/Helper" -> "Helper").
 *
 * @param {{name:string, code?:string}} script
 * @param {Array<{name:string, code?:string}>} scripts  the project's scripts
 * @returns {{ deps: Array<{name:string, code:string}>, missing: string[] }}
 */
export function collectDeps(script, scripts) {
  const byBase = new Map();
  for (const s of scripts || []) {
    const key = baseName(s.name);
    if (!byBase.has(key)) byBase.set(key, s);
  }
  const seen = new Set([baseName(script?.name)]);
  const deps = [];
  const missing = new Set();
  const queue = [String(script?.code || '')];
  while (queue.length) {
    for (const spec of relativeImports(queue.shift())) {
      const seg = spec.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
      // "./data.json", "./style.css" … are not scripts and can't be bundled here.
      if (/\.[a-z0-9]+$/i.test(seg) && !SCRIPT_EXT.test(seg)) {
        missing.add(spec);
        continue;
      }
      const key = baseName(seg);
      if (seen.has(key)) continue;
      const dep = byBase.get(key);
      if (!dep) {
        missing.add(spec);
        continue;
      }
      seen.add(key);
      deps.push({ name: dep.name, code: dep.code || '' });
      queue.push(dep.code || '');
    }
  }
  return { deps, missing: [...missing] };
}

/**
 * How a project script compares with its Shared Library original.
 * `script.origin = { sharedName, hash }` is the library content it was last
 * imported from / shared as (the baseline).
 *
 *   'none'             no baseline or no library original
 *   'in-sync'          neither side changed
 *   'update-available' library changed, local copy untouched
 *   'local-changed'    local copy edited, library untouched
 *   'conflict'         both changed
 */
export function getScriptSyncStatus(script, sharedItems) {
  const origin = script?.origin;
  if (!origin?.sharedName) return { status: 'none', lib: null };
  const lib = (sharedItems || []).find(
    (i) => i.type === 'script' && baseName(i.name) === baseName(origin.sharedName)
  );
  if (!lib) return { status: 'none', lib: null };
  const libHash = lib.hash || hashText(lib.data?.code || '');
  const localHash = hashText(script.code || '');
  if (libHash === localHash) return { status: 'in-sync', lib };
  const libChanged = libHash !== origin.hash;
  const localChanged = localHash !== origin.hash;
  let status = 'in-sync';
  if (libChanged) status = localChanged ? 'conflict' : 'update-available';
  else if (localChanged) status = 'local-changed';
  return { status, lib };
}