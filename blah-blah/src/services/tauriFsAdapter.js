import { isTauri } from '@tauri-apps/api/core';

/**
 * Normalizes and joins path segments using the appropriate separator.
 * Supports any number of arguments (variadic).
 */
export function joinPath(...segments) {
  const valid = segments.filter((s) => s !== null && s !== undefined && s !== '');
  if (valid.length === 0) return '';
  const hasBackslash = valid.some((s) => String(s).includes('\\'));
  const sep = hasBackslash ? '\\' : '/';
  return valid
    .map((seg, i) => {
      let str = String(seg);
      if (i > 0) str = str.replace(/^[/\\]+/, '');
      if (i < valid.length - 1) str = str.replace(/[/\\]+$/, '');
      return str;
    })
    .join(sep);
}

/**
 * Extracts a display folder or file name from an absolute path.
 */
export function getBaseName(filePath) {
  if (!filePath) return '';
  const parts = filePath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

/**
 * Maps common file extensions to standard MIME types for browser File creation.
 */
function getMimeType(fileName) {
  const ext = (fileName || '').split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'wav': return 'audio/wav';
    case 'mp3': return 'audio/mpeg';
    case 'ogg': return 'audio/ogg';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    case 'json': return 'application/json';
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx': return 'text/javascript';
    default: return 'application/octet-stream';
  }
}

/**
 * Creates an adapter object that behaves like browser FileSystemFileHandle,
 * backed by Tauri's @tauri-apps/plugin-fs.
 */
export function createTauriFileHandle(filePath, fileName) {
  const name = fileName || getBaseName(filePath);

  return {
    kind: 'file',
    name,
    path: filePath,
    isTauri: true,

    async getFile() {
      const fs = await import('@tauri-apps/plugin-fs');
      const bytes = await fs.readFile(filePath);
      const mime = getMimeType(name);
      return new File([bytes], name, { type: mime });
    },

    async createWritable() {
      const buffer = [];
      return {
        async write(data) {
          buffer.push(data);
        },
        async close() {
          const fs = await import('@tauri-apps/plugin-fs');
          if (buffer.length === 1 && typeof buffer[0] === 'string') {
            await fs.writeTextFile(filePath, buffer[0]);
          } else {
            // Assemble any string / Blob / File / Uint8Array chunks into binary
            const parts = [];
            for (const item of buffer) {
              if (typeof item === 'string') {
                parts.push(new TextEncoder().encode(item));
              } else if (item instanceof Blob || item instanceof File) {
                const arrayBuf = await item.arrayBuffer();
                parts.push(new Uint8Array(arrayBuf));
              } else if (item instanceof Uint8Array) {
                parts.push(item);
              } else if (item instanceof ArrayBuffer) {
                parts.push(new Uint8Array(item));
              }
            }
            const totalLen = parts.reduce((acc, p) => acc + p.byteLength, 0);
            const combined = new Uint8Array(totalLen);
            let offset = 0;
            for (const p of parts) {
              combined.set(p, offset);
              offset += p.byteLength;
            }
            await fs.writeFile(filePath, combined);
          }
        },
      };
    },
  };
}

/**
 * Creates an adapter object that behaves like browser FileSystemDirectoryHandle,
 * backed by Tauri's @tauri-apps/plugin-fs.
 */
export function createTauriDirectoryHandle(dirPath, dirName) {
  const name = dirName || getBaseName(dirPath);

  return {
    kind: 'directory',
    name,
    path: dirPath,
    isTauri: true,

    async queryPermission() {
      return 'granted';
    },

    async requestPermission() {
      return 'granted';
    },

    async getFileHandle(childName, options = {}) {
      const fs = await import('@tauri-apps/plugin-fs');
      const fullPath = joinPath(dirPath, childName);
      const fileExists = await fs.exists(fullPath);

      if (!fileExists) {
        if (options.create) {
          await fs.writeTextFile(fullPath, '');
        } else {
          const err = new Error(`File not found: ${childName}`);
          err.name = 'NotFoundError';
          throw err;
        }
      }
      return createTauriFileHandle(fullPath, childName);
    },

    async getDirectoryHandle(childName, options = {}) {
      const fs = await import('@tauri-apps/plugin-fs');
      const fullPath = joinPath(dirPath, childName);
      const dirExists = await fs.exists(fullPath);

      if (!dirExists) {
        if (options.create) {
          await fs.mkdir(fullPath, { recursive: true });
        } else {
          const err = new Error(`Directory not found: ${childName}`);
          err.name = 'NotFoundError';
          throw err;
        }
      }
      return createTauriDirectoryHandle(fullPath, childName);
    },

    async removeEntry(childName, options = {}) {
      const fs = await import('@tauri-apps/plugin-fs');
      const fullPath = joinPath(dirPath, childName);
      await fs.remove(fullPath, { recursive: !!options.recursive });
    },

    async *values() {
      const fs = await import('@tauri-apps/plugin-fs');
      const entries = await fs.readDir(dirPath);
      for (const entry of entries) {
        const fullPath = joinPath(dirPath, entry.name);
        if (entry.isDirectory) {
          yield createTauriDirectoryHandle(fullPath, entry.name);
        } else if (entry.isFile) {
          yield createTauriFileHandle(fullPath, entry.name);
        }
      }
    },

    async *entries() {
      for await (const handle of this.values()) {
        yield [handle.name, handle];
      }
    },
  };
}

/**
 * Splits a file into chunks and hands each one to `onChunk` without ever
 * holding the whole file in memory. Used by peakGenerator.js to stream a
 * long FFmpeg-decoded PCM temp file into the peak-level builder.
 *
 * Tries the streaming `open` + `read` path first. If that is unavailable
 * (older Tauri fs plugin, or a capability that hasn't granted `fs:allow-open`
 * / `fs:allow-read`), it falls back to a single `readFile` and slices it —
 * correct, just less memory-friendly — so peak generation still works.
 *
 * @param {string} filePath
 * @param {number} chunkSize - bytes per chunk (rounded up to at least 1)
 * @param {(chunk: Uint8Array) => void | Promise<void>} onChunk
 * @param {{ signal?: { aborted: boolean } }} [options]
 */
export async function readFileChunks(filePath, chunkSize, onChunk, { signal } = {}) {
  const size = Math.max(1, Math.floor(chunkSize) || 1);
  const fs = await import('@tauri-apps/plugin-fs');

  const throwIfAborted = () => {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
  };

  let handle = null;
  try {
    handle = await fs.open(filePath, { read: true });
  } catch {
    handle = null;
  }

  if (handle) {
    try {
      let buffer = new Uint8Array(size);
      for (;;) {
        throwIfAborted();
        const n = await handle.read(buffer);
        if (n === null || n === 0) break;
        await onChunk(n === buffer.length ? buffer : buffer.subarray(0, n));
      }
      return;
    } finally {
      try {
        await handle.close();
      } catch {
        // already closed / resource gone — nothing to clean up
      }
    }
  }

  // Fallback: whole-file read, sliced. No streaming, but still hands the
  // caller bounded pieces so downstream memory stays small.
  const bytes = await fs.readFile(filePath);
  for (let offset = 0; offset < bytes.length; offset += size) {
    throwIfAborted();
    await onChunk(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
  }
}

/** Creates a directory (and any missing parents). No-op when it exists. */
export async function ensureDir(dirPath) {
  if (!dirPath) return;
  const fs = await import('@tauri-apps/plugin-fs');
  if (!(await fs.exists(dirPath))) {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Stat a file, normalized to the two fields peak caching cares about.
 * Returns null when the file can't be statted (missing, permission).
 */
export async function statFile(filePath) {
  if (!filePath) return null;
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const info = await fs.stat(filePath);
    const mtime = info?.mtime instanceof Date ? info.mtime : null;
    return { size: info?.size ?? 0, mtimeMs: mtime ? mtime.getTime() : 0 };
  } catch {
    return null;
  }
}

/** Best-effort delete; swallows a missing file so cleanup can be unconditional. */
export async function removeFileIfExists(filePath) {
  if (!filePath) return;
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    await fs.remove(filePath);
  } catch {
    // already gone or not permitted — nothing else we can do
  }
}

export { isTauri };
