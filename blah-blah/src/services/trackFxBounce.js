/**
 * Offline per-track VST3 bounce.
 *
 * A track is rendered dry with the normal export mixdown (clip volume, speed,
 * trims and media offsets included; track fader/mute/solo deliberately set to
 * unity), written as float WAV, processed by the sidecar, then cached. The wet
 * file is what preview and export consume, so both hear the same result.
 */

import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { mixdownAudio } from '../engine/exportRunner';
import { encodeWavFloat32 } from '../utils/wavEncoder';
import {
  absoluteStateFile,
  activeFxSlots,
  fxCacheKey,
  hashBytes,
  isFxChainActive,
  serializeFxChain,
} from '../utils/fxChain';
import { resolveEffectiveVolume } from '../utils/trackAudio';
import {
  capturePluginState,
  openPluginEditor,
  processVstChain,
} from './vstHostRunner';

const CACHE_DIR = 'vst-cache';
const DEFAULT_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

function joinPath(...parts) {
  return parts
    .filter((part) => part !== null && part !== undefined && String(part) !== '')
    .map((part, index) => {
      const text = String(part).replace(/\\/g, '/');
      return index === 0 ? text.replace(/\/+$/, '') : text.replace(/^\/+|\/+$/g, '');
    })
    .filter(Boolean)
    .join('/');
}

function dirname(path) {
  const normalized = String(path || '').replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function projectPath(handle) {
  return handle?.path || handle?.__path || null;
}

async function fsApi() {
  return import('@tauri-apps/plugin-fs');
}

async function cacheRoot() {
  const { appDataDir } = await import('@tauri-apps/api/path');
  return joinPath(await appDataDir(), CACHE_DIR);
}

async function ensureDir(path) {
  if (!path) return;
  const fs = await fsApi();
  await fs.mkdir(path, { recursive: true }).catch((error) => {
    // mkdir recursive can race with another bounce; let exists() decide.
    if (!String(error?.message || error).toLowerCase().includes('exist')) throw error;
  });
}

async function fileExists(path) {
  const fs = await fsApi();
  try {
    return await fs.exists(path);
  } catch {
    return false;
  }
}

async function writeBytes(path, bytes) {
  const fs = await fsApi();
  await ensureDir(dirname(path));
  await fs.writeFile(path, bytes);
}

function trackRange(track, entities) {
  const own = (entities || []).filter((entity) => entity?.trackId === track.id);
  if (own.length === 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const entity of own) {
    const startTime = Number(entity.startTime) || 0;
    const duration = Number(entity.duration) || 0;
    start = Math.min(start, startTime);
    end = Math.max(end, startTime + duration);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start: Math.max(0, start), end };
}

/**
 * Render and process one range for one track.
 *
 * kind='full'   -> starts at the track's first clip, includes a short tail
 * kind='audition' -> starts up to 2 s before the playhead, output starts at the
 *                   playhead after the pre-roll is discarded by the sidecar
 */
export async function bounceTrackFx({
  track,
  entities,
  mediaAssets = [],
  projectFolderHandle,
  sampleRate = 48000,
  kind = 'full',
  playhead = 0,
  onProgress,
}) {
  if (!isTauri() || !isFxChainActive(track)) return null;
  const root = projectPath(projectFolderHandle);
  if (!root) return null;
  const slots = activeFxSlots(track);
  if (slots.length === 0) return null;
  const range = trackRange(track, entities);
  if (!range) return null;

  let renderStart;
  let renderDuration;
  let outputStart;
  let outputDuration;
  let discardHeadMs = 0;

  if (kind === 'audition') {
    const at = Math.max(0, Number(playhead) || 0);
    const preRoll = Math.min(2, at);
    renderStart = at - preRoll;
    renderDuration = preRoll + 12;
    outputStart = at;
    outputDuration = 12;
    discardHeadMs = preRoll * 1000;
  } else {
    renderStart = range.start;
    renderDuration = Math.max(0.05, range.end - range.start + 0.5);
    outputStart = renderStart;
    outputDuration = renderDuration;
  }

  const chain = serializeFxChain(track, root);
  if (chain.length === 0) return null;

  const ownEntities = (entities || []).filter((entity) => entity?.trackId === track.id);
  const key = await fxCacheKey({
    track,
    chain,
    startTime: renderStart,
    duration: renderDuration,
    sampleRate,
    entities: ownEntities,
    stateToken: (track.fx || []).map((slot) => slot.stateHash || '').join('|'),
  });
  const cacheDir = await cacheRoot();
  const wetPath = joinPath(cacheDir, `${key}.wav`);
  if (await fileExists(wetPath)) {
    return {
      path: wetPath,
      cacheKey: key,
      startTime: outputStart,
      duration: outputDuration,
      kind,
    };
  }

  // The bounce is pre-fader: the track's own fader/mute/solo stay in the
  // preview/export mixer. Clip volume and the track's source clips remain.
  const dryTrack = { ...track, volume: 1, muted: false, solo: false, fx: [], fxBypassAll: true };
  const dryBuffer = await mixdownAudio({
    entities: ownEntities,
    exportStartTime: renderStart,
    exportDuration: renderDuration,
    sampleRate,
    tracks: [dryTrack],
    mediaAssets,
  });
  if (!dryBuffer) return null;

  await ensureDir(cacheDir);
  const dryPath = joinPath(cacheDir, `${key}.dry.wav`);
  const chainPath = joinPath(cacheDir, `${key}.chain.json`);
  const left = dryBuffer.getChannelData(0);
  const right = dryBuffer.numberOfChannels > 1 ? dryBuffer.getChannelData(1) : left;
  await writeBytes(dryPath, encodeWavFloat32([left, right], sampleRate));
  await writeBytes(chainPath, new TextEncoder().encode(JSON.stringify(chain)));

  try {
    const result = await processVstChain({
      chainPath,
      inputPath: dryPath,
      outputPath: wetPath,
      sampleRate,
      discardHeadMs,
      tailMaxMs: 10000,
      onProgress,
    });
    return {
      path: wetPath,
      cacheKey: key,
      startTime: outputStart,
      duration: outputDuration,
      kind,
      latencySamples: Number(result?.latencySamples) || 0,
      warnings: Array.isArray(result?.warnings) ? result.warnings : [],
    };
  } finally {
    const fs = await fsApi();
    await Promise.all([
      fs.remove(dryPath).catch(() => {}),
      fs.remove(chainPath).catch(() => {}),
    ]);
  }
}

/** Bounce every track that has an enabled insert chain, one at a time. */
export async function bounceTracksForExport({
  tracks,
  entities,
  mediaAssets,
  projectFolderHandle,
  sampleRate = 48000,
  onProgress,
}) {
  const bounces = [];
  const failedTrackIds = [];
  const candidates = (tracks || []).filter(isFxChainActive);
  for (let index = 0; index < candidates.length; index++) {
    const track = candidates[index];
    onProgress?.({ track, index, total: candidates.length });
    try {
      const result = await bounceTrackFx({
        track,
        entities,
        mediaAssets,
        projectFolderHandle,
        sampleRate,
        kind: 'full',
      });
      if (result) bounces.push({ ...result, trackId: track.id });
      else failedTrackIds.push(track.id);
    } catch (error) {
      console.warn(`FX bounce failed for ${track.name}:`, error);
      failedTrackIds.push(track.id);
    }
  }
  return { bounces, failedTrackIds };
}

/**
 * Sum cached wet track files over the export window, applying the same
 * post-fader gain the mixer uses. `baseBuffer` is the dry mixdown with the
 * bounced tracks skipped.
 */
export async function mixTrackFxBounces({
  baseBuffer,
  bounces,
  tracks,
  exportStartTime,
  exportDuration,
  sampleRate = 48000,
}) {
  if ((!bounces || bounces.length === 0) && !baseBuffer) return null;
  const frames = Math.max(1, Math.ceil((exportDuration || 0) * sampleRate));
  const ctx = new OfflineAudioContext(2, frames, sampleRate);

  if (baseBuffer) {
    const source = ctx.createBufferSource();
    source.buffer = baseBuffer;
    source.connect(ctx.destination);
    source.start(0);
  }

  for (const bounce of bounces || []) {
    try {
      const response = await fetch(convertFileSrc(bounce.path));
      const bytes = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(bytes.slice(0));
      const track = (tracks || []).find((item) => item.id === bounce.trackId);
      const gain = track ? resolveEffectiveVolume(1, track, tracks) : 1;
      if (!(gain > 0)) continue;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gainNode = ctx.createGain();
      gainNode.gain.value = gain;
      source.connect(gainNode).connect(ctx.destination);

      const relativeStart = bounce.startTime - exportStartTime;
      const offset = Math.max(0, -relativeStart);
      const when = Math.max(0, relativeStart);
      if (when >= exportDuration) continue;
      const available = buffer.duration - offset;
      const playDuration = Math.min(available, exportDuration - when);
      if (playDuration <= 0) continue;
      source.start(when, offset, playDuration);
    } catch (error) {
      console.warn(`Could not mix FX bounce ${bounce.path}:`, error);
    }
  }

  return ctx.startRendering();
}

/** Create the slot's state file on demand and return its hash. */
export async function ensureFxStateFile({ projectFolderHandle, slot }) {
  const root = projectPath(projectFolderHandle);
  if (!root || !slot?.stateFile) return null;
  const statePath = absoluteStateFile(slot.stateFile, root);
  if (!statePath) return null;
  try {
    await capturePluginState({
      pluginPath: slot.pluginPath,
      classId: slot.classId,
      stateFile: statePath,
    });
    const fs = await fsApi();
    const bytes = await fs.readFile(statePath);
    return { stateFile: slot.stateFile, stateHash: await hashBytes(bytes) };
  } catch (error) {
    console.warn('Could not create plugin state file:', error);
    return null;
  }
}

/** Open the native editor and persist the state written on close. */
export async function editFxSlot({ projectFolderHandle, track, slot }) {
  const root = projectPath(projectFolderHandle);
  if (!root || !slot) return null;
  const statePath = absoluteStateFile(slot.stateFile, root);
  if (!statePath) return null;
  await ensureDir(dirname(statePath));
  await openPluginEditor({
    pluginPath: slot.pluginPath,
    classId: slot.classId,
    stateFile: await fileExists(statePath) ? statePath : null,
    stateOut: statePath,
    title: `${slot.name || 'VST3'} — ${track?.name || 'Track'}`,
  });
  const fs = await fsApi();
  const bytes = await fs.readFile(statePath);
  return { stateFile: slot.stateFile, stateHash: await hashBytes(bytes) };
}

export async function getVstCacheStats() {
  if (!isTauri()) return { bytes: 0, files: 0 };
  const root = await cacheRoot();
  if (!(await fileExists(root))) return { bytes: 0, files: 0 };
  const fs = await fsApi();
  const entries = await fs.readDir(root).catch(() => []);
  let bytes = 0;
  let files = 0;
  for (const entry of entries) {
    if (!entry?.isFile || !entry.name.endsWith('.wav')) continue;
    try {
      const info = await fs.stat(joinPath(root, entry.name));
      bytes += Number(info.size) || 0;
      files += 1;
    } catch {
      // A file removed by another clear/prune is fine.
    }
  }
  return { bytes, files };
}

/** Remove oldest cached wet files until the cache is under the limit. */
export async function pruneVstCache(maxBytes = DEFAULT_CACHE_LIMIT_BYTES) {
  if (!isTauri()) return { removed: 0, bytes: 0 };
  const root = await cacheRoot();
  if (!(await fileExists(root))) return { removed: 0, bytes: 0 };
  const fs = await fsApi();
  const entries = await fs.readDir(root).catch(() => []);
  const files = [];
  let total = 0;
  for (const entry of entries) {
    if (!entry?.isFile || !entry.name.endsWith('.wav')) continue;
    try {
      const path = joinPath(root, entry.name);
      const info = await fs.stat(path);
      const size = Number(info.size) || 0;
      total += size;
      files.push({ path, size, mtime: Number(info.mtime?.getTime?.() || info.mtime) || 0 });
    } catch {
      // ignore
    }
  }
  if (total <= maxBytes) return { removed: 0, bytes: total };
  files.sort((a, b) => a.mtime - b.mtime);
  let removed = 0;
  for (const file of files) {
    if (total <= maxBytes) break;
    try {
      await fs.remove(file.path);
      total -= file.size;
      removed += 1;
    } catch {
      // ignore
    }
  }
  return { removed, bytes: total };
}

export async function clearVstCache() {
  if (!isTauri()) return;
  const root = await cacheRoot();
  const fs = await fsApi();
  await fs.remove(root, { recursive: true }).catch(() => {});
}
