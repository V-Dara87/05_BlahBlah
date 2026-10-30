import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * True when `child` is `parent` itself or lives somewhere underneath it.
 */
export function isInside(parent, child) {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

/**
 * Roots that tools are allowed to touch, from BLAHBLAH_ALLOWED_ROOTS
 * (separated by the platform path delimiter). Returns null when no
 * restriction is configured.
 */
export function getAllowedRoots(env = process.env) {
  const raw = env.BLAHBLAH_ALLOWED_ROOTS;
  if (!raw) return null;
  const roots = raw
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
  return roots.length > 0 ? roots : null;
}

export function assertAllowedPath(target, env = process.env) {
  const roots = getAllowedRoots(env);
  if (!roots) return target;
  const resolved = path.resolve(target);
  if (!roots.some((root) => isInside(root, resolved))) {
    throw new Error(
      `Path "${resolved}" is outside the allowed roots (BLAHBLAH_ALLOWED_ROOTS).`
    );
  }
  return resolved;
}

/**
 * Resolves a project directory and enforces the allowed-roots policy.
 * With `required: true` an empty value is an error instead of silently
 * falling back to the current working directory.
 */
export function resolveProjectDir(dir, { required = false } = {}) {
  if (dir === undefined || dir === null || dir === '') {
    if (required) {
      throw new Error('A project directory ("dir") is required.');
    }
    dir = process.cwd();
  }
  if (typeof dir !== 'string') {
    throw new Error('Project directory must be a string path.');
  }
  return assertAllowedPath(path.resolve(dir));
}

async function renameWithRetry(from, to) {
  const transient = new Set(['EPERM', 'EBUSY', 'EACCES']);
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      lastErr = err;
      if (!transient.has(err.code)) throw err;
      // Windows can briefly lock the target (antivirus, indexer, editor).
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * Writes a file atomically: data goes to a temp file in the same folder, is
 * flushed to disk, then renamed over the target. A crash mid-write leaves the
 * old file intact. With `backup`, the previous file is first copied to
 * `<file>.bak`.
 */
export async function atomicWriteFile(filePath, data, { backup = false } = {}) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );

  try {
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(data, typeof data === 'string' ? 'utf8' : undefined);
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (backup) {
      try {
        await fs.copyFile(filePath, `${filePath}.bak`);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    await renameWithRetry(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

const queues = new Map();

/**
 * Runs `fn` after every earlier task with the same key has finished, so two
 * read-modify-write cycles on the same file can never interleave in this
 * process.
 */
export function withLock(key, fn) {
  const previous = queues.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

export function hashText(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}