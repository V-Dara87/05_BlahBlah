import { isTauri } from '@tauri-apps/api/core';

/**
 * Normalizes and joins two path segments using the appropriate separator.
 */
export function joinPath(base, child) {
  const cleanBase = (base || '').replace(/[/\\]+$/, '');
  const cleanChild = (child || '').replace(/^[/\\]+/, '');
  const sep = cleanBase.includes('\\') ? '\\' : '/';
  return `${cleanBase}${sep}${cleanChild}`;
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

export { isTauri };
