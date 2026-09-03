/**
 * Reads relative-import targets from a project's scripts/ folder for the
 * real-`import` bundler (scriptBundler.js).
 *
 * Kept OUT of services/projectFileSystem.js on purpose: that module
 * imports the SDK's .d.ts via Vite's `?raw` query, which breaks plain
 * Node execution (e.g. the bundler test harness). This tiny reader has no
 * such dependency and can run anywhere a FileSystemDirectoryHandle exists.
 */

/**
 * Resolve a (possibly nested) path like 'lib/helpers.js' against a
 * directory handle, walking subdirectories — FileSystemDirectoryHandle's
 * getFileHandle only accepts a single name, not a '/' path.
 */
async function getFileHandleByPath(dirHandle, path) {
  const parts = path.split('/');
  let current = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    current = await current.getDirectoryHandle(parts[i], { create: false });
  }
  return current.getFileHandle(parts[parts.length - 1], { create: false });
}

/**
 * Read a relative import target from the scripts/ folder. Probes the path
 * as-is plus common extensions and /index.* forms, matching how
 * Node/esbuild would resolve it. `dirHandle` must be the scripts/
 * directory. Returns `{ path, code }` for the first candidate that
 * exists, or null.
 */
export async function readScriptFile(dirHandle, relativePath) {
  if (!dirHandle) return null;
  const normalized = relativePath.replace(/^\.\//, '');
  const candidates = [
    normalized,
    `${normalized}.js`,
    `${normalized}.jsx`,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}/index.js`,
    `${normalized}/index.jsx`,
  ];

  for (const candidate of candidates) {
    try {
      const fileHandle = await getFileHandleByPath(dirHandle, candidate);
      const file = await fileHandle.getFile();
      return { path: candidate, code: await file.text() };
    } catch {
      // FileSystem API throws NotFoundError for missing entries — try next candidate.
    }
  }
  return null;
}