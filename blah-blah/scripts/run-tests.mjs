#!/usr/bin/env node
/**
 * Run every test file in the repository.
 *
 * The old npm test script listed files by hand, so new tests were silently not
 * run (motion-tween, reference, scriptConsoleFocus, scriptErrorInfo and any
 * future file). This runner discovers them instead:
 *
 *   tests/**\/*.test.mjs
 *   src/**\/*.test.js
 *   packages/**\/tests/*.test.mjs
 *
 * Each file is spawned in its own Node process, exactly as the old explicit
 * list did, and the exit status is non-zero as soon as one file fails.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '.git']);

function collect(dir, testFile) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...collect(path.join(dir, entry.name), testFile));
    } else if (entry.isFile() && testFile(entry.name)) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

const files = [
  ...collect(path.join(root, 'tests'), (name) => name.endsWith('.test.mjs')),
  ...collect(path.join(root, 'src'), (name) => name.endsWith('.test.js')),
  ...collect(path.join(root, 'packages'), (name) => name.endsWith('.test.mjs')),
].sort();

if (files.length === 0) {
  console.error('No test files were found.');
  process.exit(1);
}

const failures = [];
for (const file of files) {
  const relative = path.relative(root, file);
  process.stdout.write(`\n▶ ${relative}\n`);
  const result = spawnSync(process.execPath, [file], { cwd: root, stdio: 'inherit' });
  if (result.error) {
    failures.push({ relative, reason: result.error.message });
    console.error(`✖ ${relative}: ${result.error.message}`);
  } else if (result.status !== 0) {
    failures.push({ relative, reason: `exit ${result.status}` });
    console.error(`✖ ${relative} failed (exit ${result.status})`);
  }
}

console.log('');
if (failures.length > 0) {
  console.error(`✖ ${failures.length} of ${files.length} test files failed:`);
  for (const failure of failures) console.error(`  - ${failure.relative} (${failure.reason})`);
  process.exit(1);
}
console.log(`✔ ${files.length} test files passed.`);
