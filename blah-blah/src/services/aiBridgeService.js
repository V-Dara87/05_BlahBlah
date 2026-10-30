/**
 * AI Bridge Service.
 *
 * Architecture & Decision:
 * ---------------------------------------------------------------------------
 * Choice: File-based IPC polling via `.aibridge/inbox` and `.aibridge/outbox`.
 *
 * Why:
 * 1. Simplicity & Portability: Works immediately in Tauri desktop without requiring
 *    custom Rust native networking plugins, sidecar processes, or background threads.
 * 2. In Vite dev (either via `npm run tauri dev` or browser preview), it uses the
 *    filesystem adapter seamlessly and degrades gracefully if no disk handle exists.
 * 3. Parity with blahblah-core: Matches the file IPC protocol (`sendFileCommand`,
 *    `writeFileResult`, `waitForResult`) implemented in `blahblah-core/src/bridge.js`,
 *    providing identical atomic guarantees, crash tolerance, and zero TCP port collisions.
 * 4. Strict Security: Enforces bearer token verification from `.aibridge/token` and
 *    Origin verification on all commands before execution. Stale commands (>5 min)
 *    are discarded on startup.
 */

import { isTauri, joinPath } from './tauriFsAdapter';
import {
  DEFAULT_MAX_COMMAND_AGE_MS,
  MAX_FRAME_LONG_SIDE,
  verifyBridgeToken,
  isCommandStale,
  calculateDownscaleDimensions,
  formatBridgeResult,
  base64ToUint8Array,
} from '../utils/aiBridgeCore';
import { drawExportFrame, createCanvasContainerPool } from '../engine/exportRunner';

/**
 * Generates paths for .aibridge directory structure.
 */
export function getBridgePaths(projectDir) {
  if (!projectDir) return null;
  const root = joinPath(projectDir, '.aibridge');
  return {
    root,
    inbox: joinPath(root, 'inbox'),
    outbox: joinPath(root, 'outbox'),
    token: joinPath(root, 'token'),
    latest: joinPath(root, 'command.json'),
  };
}

async function getFs() {
  if (isTauri()) {
    try {
      return await import('@tauri-apps/plugin-fs');
    } catch (err) {
      console.warn('AI Bridge: Tauri fs plugin could not be imported:', err);
      return null;
    }
  }
  return null;
}

/**
 * Ensures that the .aibridge/inbox and .aibridge/outbox directories exist on disk.
 */
export async function ensureBridgeDirectories(projectDir) {
  const fs = await getFs();
  if (!fs || !projectDir) return;
  const paths = getBridgePaths(projectDir);
  try {
    if (!(await fs.exists(paths.inbox))) {
      await fs.mkdir(paths.inbox, { recursive: true });
    }
    if (!(await fs.exists(paths.outbox))) {
      await fs.mkdir(paths.outbox, { recursive: true });
    }
  } catch (err) {
    console.warn('AI Bridge: failed to ensure directories:', err);
  }
}

/**
 * Reads the existing bridge token or generates a new cryptographically secure one.
 */
export async function readOrGenerateBridgeToken(projectDir) {
  const fs = await getFs();
  if (!fs || !projectDir) return null;
  const paths = getBridgePaths(projectDir);
  try {
    if (await fs.exists(paths.token)) {
      const existing = (await fs.readTextFile(paths.token)).trim();
      if (existing) return existing;
    }
    // Generate secure 32-byte hex token
    const randomBytes = new Uint8Array(24);
    crypto.getRandomValues(randomBytes);
    const newToken = Array.from(randomBytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await fs.writeTextFile(paths.token, newToken);
    return newToken;
  } catch (err) {
    console.warn('AI Bridge: failed to read/generate token:', err);
    return null;
  }
}

/**
 * Purges stale commands (>5 minutes old) from the inbox on editor startup.
 */
export async function cleanupStaleInboxCommands(projectDir, maxAgeMs = DEFAULT_MAX_COMMAND_AGE_MS) {
  const fs = await getFs();
  if (!fs || !projectDir) return;
  const paths = getBridgePaths(projectDir);
  try {
    if (!(await fs.exists(paths.inbox))) return;
    const entries = await fs.readDir(paths.inbox);
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isFile || !entry.name.endsWith('.json')) continue;
      const filePath = joinPath(paths.inbox, entry.name);
      try {
        const text = await fs.readTextFile(filePath);
        const cmd = JSON.parse(text);
        if (isCommandStale(cmd.timestamp, now, maxAgeMs)) {
          await fs.remove(filePath);
        }
      } catch {
        // Corrupt or unreadable file: remove it
        await fs.remove(filePath).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('AI Bridge: failed to cleanup stale inbox:', err);
  }
}

/**
 * Atomically writes the result JSON to .aibridge/outbox/<id>.json.
 */
export async function writeBridgeResult(projectDir, id, result) {
  const fs = await getFs();
  if (!fs || !projectDir || !id) return;
  const paths = getBridgePaths(projectDir);
  const outPath = joinPath(paths.outbox, `${id}.json`);
  const tmpPath = `${outPath}.${Date.now().toString(36)}.tmp`;
  const json = JSON.stringify(formatBridgeResult(id, result.ok, result), null, 2);

  try {
    await fs.writeTextFile(tmpPath, json);
    await fs.rename(tmpPath, outPath);
  } catch (err) {
    try {
      await fs.remove(tmpPath);
    } catch {}
    // Fallback direct write
    await fs.writeTextFile(outPath, json).catch((e) => {
      console.error('AI Bridge: failed to write result:', e);
    });
  }
}

/**
 * Writes the PNG image bytes to .aibridge/outbox/<id>.png.
 */
export async function writeBridgeFramePng(projectDir, id, pngBase64) {
  const fs = await getFs();
  if (!fs || !projectDir || !id || !pngBase64) return;
  const paths = getBridgePaths(projectDir);
  const pngPath = joinPath(paths.outbox, `${id}.png`);
  const tmpPath = `${pngPath}.${Date.now().toString(36)}.tmp`;
  const bytes = base64ToUint8Array(pngBase64);

  try {
    await fs.writeFile(tmpPath, bytes);
    await fs.rename(tmpPath, pngPath);
  } catch (err) {
    try {
      await fs.remove(tmpPath);
    } catch {}
    // Fallback direct write
    await fs.writeFile(pngPath, bytes).catch((e) => {
      console.error('AI Bridge: failed to write frame png:', e);
    });
  }
}

/**
 * Renders a real composited video frame via the editor's engine export pipeline.
 * Downscales to maxLongSide (default 1280px) to keep AI token cost low.
 */
export async function renderEditorFrame({
  time = 0,
  entities = [],
  tracks = [],
  scripts = [],
  resolution = { width: 1920, height: 1080 },
  mediaAssets = [],
  maxLongSide = MAX_FRAME_LONG_SIDE,
}) {
  if (typeof document === 'undefined') {
    throw new Error('renderEditorFrame requires a DOM environment');
  }

  const origW = resolution?.width || 1920;
  const origH = resolution?.height || 1080;
  const { width, height } = calculateDownscaleDimensions(origW, origH, maxLongSide);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const pool = createCanvasContainerPool();
  try {
    await drawExportFrame({
      ctx,
      width,
      height,
      projectWidth: origW,
      projectHeight: origH,
      time,
      entities,
      tracks,
      scripts,
      fps: 30,
      canvasContainers: pool,
      mediaAssets,
    });

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

    return {
      pngBase64: base64,
      width,
      height,
      time,
      fidelity: 'editor',
    };
  } finally {
    try {
      pool.disposeAll();
    } catch {
      // Best-effort cleanup
    }
  }
}
