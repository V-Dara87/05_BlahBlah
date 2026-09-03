// scripts/copy-esbuild-wasm.mjs
//
// `src/engine/scriptRunner.js` calls `esbuild.initialize({ wasmURL:
// '/esbuild.wasm', ... })`, expecting Vite to serve that file as a
// static asset from `public/`. Nothing ever put it there — the
// `esbuild-wasm` npm package ships the binary under its own
// `node_modules` folder, not `public/` — so every esbuild init call
// 404s in the browser (caught, falls back to the regex transpiler, but
// the esbuild path never runs).
//
// Run automatically via the `postinstall` script in package.json so the
// binary is always in sync with whatever `esbuild-wasm` version is
// actually installed, on every fresh `npm install`.
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
 
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const src = path.join(repoRoot, 'node_modules', 'esbuild-wasm', 'esbuild.wasm');
const destDir = path.join(repoRoot, 'public');
const dest = path.join(destDir, 'esbuild.wasm');
 
try {
  await mkdir(destDir, { recursive: true });
  await copyFile(src, dest);
  console.log(`[copy-esbuild-wasm] Copied ${src} -> ${dest}`);
} catch (err) {
  // Non-fatal: scriptRunner.js already falls back to the regex
  // transpiler if /esbuild.wasm 404s, so a failed copy here shouldn't
  // block `npm install`. Just warn loudly so it doesn't go unnoticed.
  console.warn(
    `[copy-esbuild-wasm] Could not copy esbuild.wasm into public/ (esbuild-wasm ` +
    `acceleration will be unavailable, falling back to the regex transpiler). ` +
    `Reason: ${err.message}`
  );
}