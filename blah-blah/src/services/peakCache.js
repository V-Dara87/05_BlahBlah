/**
 * peakCache — the front door to a project's generated waveform peak files.
 *
 * Three jobs, all keyed off the current project:
 *
 *   1. Resolve an asset to its peak file. The name embeds the media file's
 *      name, byte size and last-modified time, so replacing or editing a
 *      source file automatically invalidates its cached peaks (a new file
 *      name) with no bookkeeping.
 *   2. Serve parsed peaks, with a small bounded memory LRU in front of disk
 *      (see MAX_MEMORY_PEAKS / MAX_MEMORY_BYTES — a handful of ~10 MB peak
 *      files, not the whole media library).
 *   3. Generate missing peaks in the background, one file at a time, via
 *      services/peakGenerator.js, and expose each asset's status
 *      ("pending" / "generating" / "ready" / "failed") plus progress to the
 *      UI.
 *
 * Outside Tauri (or without a project directory) generation is simply
 * unsupported: the queue never starts and lookups return null, which is what
 * lets utils/audioWaveform.js fall back to the old decode path for short
 * files in the browser.
 */

import {
  peakDirPath,
  peakTempDirPath,
  writePeakFile,
  readPeakFile,
  peakFileExists,
  deletePeakFile,
} from './projectFileSystem.js';
import { generatePeaksForAsset, isPeakGenerationSupported } from './peakGenerator.js';
import { parsePeakFile } from '../utils/peaksFormat.js';
import { statFile } from './tauriFsAdapter.js';

/**
 * How many parsed peak files to keep resident at once.
 *
 * MAX_MEMORY_BYTES is what actually bounds memory (~10 MB per hour of audio);
 * this count only exists to stop a huge library pinning tiny files. It has to
 * comfortably cover the number of distinct media files a timeline can have on
 * screen at once: with a smaller window, a project with a handful of
 * multi-track long files kept evicting each other and re-reading + re-parsing
 * multi-MB peak files on every zoom step, which is felt as the waveform
 * stuttering while dragging/zooming.
 */
export const MAX_MEMORY_PEAKS = 24;
/** Rough ceiling on resident peak-file bytes (~10 MB/hour each). */
export const MAX_MEMORY_BYTES = 64 * 1024 * 1024;
/**
 * How many times a single asset may fail generation before it is left alone.
 * A transient failure (disk full, file briefly locked, FFmpeg hiccup) should
 * get retried; a genuinely broken file (corrupt media, missing codec) must
 * NOT be re-run on every render that happens to enqueue it.
 */
export const MAX_PEAK_GENERATION_ATTEMPTS = 3;
/** Backoff before a failed asset is re-queued (multiplied by the attempt count). */
export const PEAK_RETRY_DELAY_MS = 1500;

// ─── Context ─────────────────────────────────────────────────────────────

/** @type {{ path?: string } | null} */
let projectDirHandle = null;
/** @type {null | (() => Array)} */
let mediaAssetsSource = null;

/** Point the cache at the currently open project (null when none). */
export function setPeakProjectDirectory(dirHandle) {
  if (projectDirHandle === dirHandle) return;
  projectDirHandle = dirHandle || null;
  resetPeakCache();
}

/** Register how to read the current media library (for id/url resolution). */
export function setMediaAssetsSource(getter) {
  mediaAssetsSource = typeof getter === 'function' ? getter : null;
}

/** The open project's peak directory (absolute path, Tauri only) or null. */
export function getPeakDirectoryPath() {
  return peakDirPath(projectDirHandle);
}

function listAssets() {
  try {
    const assets = mediaAssetsSource?.();
    return Array.isArray(assets) ? assets : [];
  } catch {
    return [];
  }
}

/** Resolve a library asset by id. */
export function getAssetById(assetId) {
  if (!assetId) return null;
  return listAssets().find((a) => a?.id === assetId) || null;
}

/** Resolve a library asset by its playback URL (or, failing that, its name). */
export function getAssetByUrl(url) {
  if (!url) return null;
  const assets = listAssets();
  const exact = assets.find((a) => a?.url === url);
  if (exact) return exact;
  // Clip entities can hold a URL that predates a re-point (blob -> disk).
  // Match on the tail of the path so the waveform for a clip still resolves
  // to the right asset.
  return assets.find((a) => {
    if (!a?.url) return false;
    const tail = (s) => String(s).split(/[/\\]/).pop();
    return tail(a.url) === tail(url);
  }) || null;
}

// ─── File naming ─────────────────────────────────────────────────────────

// assetIdentity -> resolved peak file name. Keyed on id+path+size so a
// replaced/re-imported asset (which changes size) resolves to a fresh name
// while repeated lookups for the same file stay cheap.
const nameCache = new Map();

const sanitizeBase = (name) => {
  const base = String(name || 'audio').split(/[/\\]/).pop() || 'audio';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.slice(0, 72) || 'audio';
};

/**
 * The peak file name for an asset — name + size + mtime, so a changed source
 * regenerates. Returns null when the asset has no on-disk path (browser) or
 * cannot be statted.
 */
export async function peakFileNameForAsset(asset) {
  if (!asset?.path) return null;
  const identity = `${asset.id}|${asset.path}|${asset.size ?? ''}`;
  if (nameCache.has(identity)) return nameCache.get(identity);

  const info = await statFile(asset.path);
  if (!info) return null;
  const fileName = `${sanitizeBase(asset.name)}.${info.size}.${info.mtimeMs || 0}.peaks`;
  nameCache.set(identity, fileName);
  return fileName;
}

// ─── Memory LRU ──────────────────────────────────────────────────────────

/** @type {Map<string, { parsed: object, bytes: number }>} (insertion order = LRU) */
const memoryPeaks = new Map();
/** File names confirmed absent on disk, so we don't re-stat them constantly. */
const missingPeaks = new Set();
let memoryBytes = 0;

function memoryGet(fileName) {
  const entry = memoryPeaks.get(fileName);
  if (!entry) return null;
  // Refresh recency.
  memoryPeaks.delete(fileName);
  memoryPeaks.set(fileName, entry);
  return entry.parsed;
}

function memorySet(fileName, parsed) {
  const bytes = parsed?.levels?.[0]?.length || 0;
  if (memoryPeaks.has(fileName)) {
    memoryBytes -= memoryPeaks.get(fileName).bytes || 0;
    memoryPeaks.delete(fileName);
  }
  memoryPeaks.set(fileName, { parsed, bytes });
  memoryBytes += bytes;
  while (memoryPeaks.size > MAX_MEMORY_PEAKS || (memoryBytes > MAX_MEMORY_BYTES && memoryPeaks.size > 1)) {
    const oldest = memoryPeaks.keys().next().value;
    memoryBytes -= memoryPeaks.get(oldest).bytes || 0;
    memoryPeaks.delete(oldest);
  }
}

// ─── Lookup ──────────────────────────────────────────────────────────────

/** True when a peak file exists on disk (or is already parsed in memory). */
export async function hasPeaks(asset) {
  if (!projectDirHandle || !asset) return false;
  const fileName = await peakFileNameForAsset(asset);
  if (!fileName) return false;
  if (memoryPeaks.has(fileName)) return true;
  if (missingPeaks.has(fileName)) return false;
  const exists = await peakFileExists(projectDirHandle, fileName);
  if (!exists) missingPeaks.add(fileName);
  return exists;
}

/**
 * Get parsed peaks for an asset (memory LRU, then disk), or null when there
 * is no peak file. Never throws.
 */
export async function getPeaks(asset) {
  if (!projectDirHandle || !asset) return null;
  const fileName = await peakFileNameForAsset(asset);
  if (!fileName) return null;

  const cached = memoryGet(fileName);
  if (cached) return cached;
  if (missingPeaks.has(fileName)) return null;

  const bytes = await readPeakFile(projectDirHandle, fileName);
  if (!bytes) {
    missingPeaks.add(fileName);
    return null;
  }
  const parsed = parsePeakFile(bytes);
  if (!parsed) {
    // Corrupt / half-written: treat as missing so it gets regenerated.
    missingPeaks.add(fileName);
    return null;
  }
  memorySet(fileName, parsed);
  return parsed;
}

/** Convenience for consumers that only have a URL (the timeline draw path). */
export async function getPeaksForUrl(url) {
  const asset = getAssetByUrl(url);
  if (!asset) return null;
  return getPeaks(asset);
}

/** Persist generated peak bytes for an asset and warm the memory cache. */
export async function savePeaks(asset, bytes) {
  if (!projectDirHandle || !asset || !bytes) return false;
  const fileName = await peakFileNameForAsset(asset);
  if (!fileName) return false;
  const ok = await writePeakFile(projectDirHandle, fileName, bytes);
  if (!ok) return false;
  missingPeaks.delete(fileName);
  const parsed = parsePeakFile(bytes);
  if (parsed) memorySet(fileName, parsed);
  return true;
}

// ─── Status + subscriptions ──────────────────────────────────────────────

/** @type {Map<string, { status: string, progress: number, attempts: number }>} */
const statuses = new Map();
const statusListeners = new Set();
const updatedListeners = new Set();

export function getPeakStatus(assetId) {
  return statuses.get(assetId)?.status || 'none';
}

export function getPeakProgress(assetId) {
  return statuses.get(assetId)?.progress || 0;
}

/** Subscribe to per-asset status changes. Returns an unsubscribe fn. */
export function subscribePeakStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Subscribe to "some asset's peaks became ready" (WaveformCanvas redraw). */
export function subscribePeaksUpdated(listener) {
  updatedListeners.add(listener);
  return () => updatedListeners.delete(listener);
}

function notifyStatus(assetId, status, progress) {
  for (const listener of statusListeners) {
    try {
      listener(assetId, status, progress);
    } catch (err) {
      console.error('[peakCache] status listener threw:', err);
    }
  }
}

/**
 * Update an asset's status, preserving its attempt count unless overridden.
 * Progress updates during generation must not reset attempts.
 */
function setStatus(assetId, status, progress = 0, attemptsOverride = null) {
  const attempts = attemptsOverride != null
    ? attemptsOverride
    : statuses.get(assetId)?.attempts || 0;
  statuses.set(assetId, { status, progress, attempts });
  notifyStatus(assetId, status, progress);
}

function emitPeaksUpdated(assetId) {
  for (const listener of updatedListeners) {
    try {
      listener(assetId);
    } catch (err) {
      console.error('[peakCache] peaks-updated listener threw:', err);
    }
  }
}

// ─── Generation queue ────────────────────────────────────────────────────

const queue = [];
/** Latest asset snapshot per queued id, so generation uses the freshest
 * path/url/size even if React state hasn't re-rendered the library yet. */
const pendingAssets = new Map();
let processing = false;

/**
 * Queue background peak generation for an asset. No-op when the environment
 * can't generate peaks, when the asset is already ready/in flight, or when it
 * has no on-disk path yet (the caller should re-enqueue once it does — see
 * useMediaAssets, which enqueues again after an import lands in media/).
 *
 * A `failed` asset IS re-queued, up to MAX_PEAK_GENERATION_ATTEMPTS — see the
 * retry scheduling in drainQueue and resetPeakStatusForAsset for a forced
 * retry (used when the underlying file is replaced).
 */
export function enqueuePeakGeneration(asset) {
  if (!isPeakGenerationSupported() || !projectDirHandle || !asset?.id || !asset?.path) return;
  const entry = statuses.get(asset.id);
  const current = entry?.status;
  // Terminal-ish states: already done, or in flight. A `failed` asset is
  // retried up to MAX_PEAK_GENERATION_ATTEMPTS; after that it is left alone
  // so a genuinely broken file doesn't hammer FFmpeg on every render.
  if (current === 'ready' || current === 'generating' || current === 'pending') return;
  if (current === 'failed' && (entry?.attempts || 0) >= MAX_PEAK_GENERATION_ATTEMPTS) return;
  if (queue.includes(asset.id)) {
    pendingAssets.set(asset.id, asset);
    return;
  }
  queue.push(asset.id);
  pendingAssets.set(asset.id, asset);
  setStatus(asset.id, 'pending');
  void drainQueue();
}

/** Enqueue generation for every asset in a list (used when a project opens). */
export function ensurePeaksForAssets(assets) {
  if (!Array.isArray(assets)) return;
  for (const asset of assets) enqueuePeakGeneration(asset);
}

async function generateOne(asset) {
  if (await hasPeaks(asset)) {
    // Already on disk (e.g. generated in a previous session) — just warm
    // the memory cache so the first draw is a hit.
    await getPeaks(asset);
    return;
  }
  const result = await generatePeaksForAsset({
    sourcePath: asset.path,
    durationSec: asset.duration || 0,
    tempDirPath: peakTempDirPath(projectDirHandle),
    onProgress: ({ ratio }) => setStatus(asset.id, 'generating', ratio),
  });
  if (result?.status === 'unsupported') return;
  await savePeaks(asset, result.bytes);
}

async function drainQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const assetId = queue.shift();
      const asset = pendingAssets.get(assetId) || getAssetById(assetId);
      pendingAssets.delete(assetId);
      if (!asset || !asset.path || !projectDirHandle) {
        statuses.delete(assetId);
        continue;
      }
      setStatus(assetId, 'generating', 0);
      try {
        await generateOne(asset);
        setStatus(assetId, 'ready', 1);
        emitPeaksUpdated(assetId);
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.warn(`[peakCache] Peak generation failed for "${asset.name}":`, err);
        }
        // Count the attempt so a repeated failure eventually stops being
        // re-queued (see enqueuePeakGeneration).
        const attempts = (statuses.get(assetId)?.attempts || 0) + 1;
        setStatus(assetId, 'failed', 0, attempts);

        // Nothing else re-enqueues an unchanged library, so a transient
        // failure (locked file, disk full, FFmpeg hiccup) would otherwise
        // stay broken for the whole session. Retry with a little backoff,
        // but stop once the cap is reached so a genuinely broken file is
        // not re-run forever. Guard on the project handle so a retry can't
        // land in a project that was opened in the meantime.
        if (attempts < MAX_PEAK_GENERATION_ATTEMPTS) {
          const projectAtFailure = projectDirHandle;
          setTimeout(() => {
            if (projectDirHandle !== projectAtFailure) return;
            enqueuePeakGeneration(asset);
          }, PEAK_RETRY_DELAY_MS * attempts);
        }
      }
    }
  } finally {
    processing = false;
  }
}

// ─── Invalidation ────────────────────────────────────────────────────────

/**
 * Forget everything cached for one asset — used when its underlying file is
 * replaced (same id, new bytes) so generation runs again for the new file.
 */
export function resetPeakStatusForAsset(assetId) {
  if (!assetId) return;
  statuses.delete(assetId);
  pendingAssets.delete(assetId);
  for (const key of [...nameCache.keys()]) {
    if (key.startsWith(`${assetId}|`)) nameCache.delete(key);
  }
  const index = queue.indexOf(assetId);
  if (index !== -1) queue.splice(index, 1);
}

/** Remove an asset's generated peak file (e.g. when the asset is deleted). */
export async function deletePeaksForAsset(asset) {
  if (!asset) return;
  const fileName = await peakFileNameForAsset(asset);
  if (fileName && projectDirHandle) {
    try {
      await deletePeakFile(projectDirHandle, fileName);
    } catch {
      // best effort
    }
    memoryPeaks.delete(fileName);
    missingPeaks.delete(fileName);
  }
  resetPeakStatusForAsset(asset.id);
}

// ─── Reset ───────────────────────────────────────────────────────────────

/** Drop every cached/queued bit of peak state (on project switch). */
export function resetPeakCache() {
  memoryPeaks.clear();
  missingPeaks.clear();
  nameCache.clear();
  statuses.clear();
  pendingAssets.clear();
  queue.length = 0;
}
