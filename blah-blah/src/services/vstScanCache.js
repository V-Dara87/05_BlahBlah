/**
 * Local plugin scan cache. No scan is run at startup: the cache is read when
 * the FX picker or Settings > Audio > Plugins is opened, and refreshed only on
 * request or after it is a day old.
 */

import { readJson, writeJson } from '../utils/appStorage.js';
import { loadAudioSettings, updateAudioSettings } from './audioSettings.js';
import { scanVstPlugins } from './vstHostRunner.js';

const STORAGE_KEY = 'blahblah.vstScan.v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function normalize(cache) {
  const value = cache && typeof cache === 'object' ? cache : {};
  return {
    dirs: Array.isArray(value.dirs) ? value.dirs.filter((d) => typeof d === 'string') : [],
    plugins: Array.isArray(value.plugins) ? value.plugins : [],
    failed: Array.isArray(value.failed) ? value.failed : [],
    scannedAt: Number(value.scannedAt) || 0,
    backendVersion: typeof value.backendVersion === 'string' ? value.backendVersion : null,
  };
}

export function loadVstScanCache() {
  return normalize(readJson(STORAGE_KEY, null));
}

export function saveVstScanCache(cache) {
  const next = normalize(cache);
  writeJson(STORAGE_KEY, next);
  return next;
}

export function getVstScanDirs() {
  return loadAudioSettings().vstScanDirs;
}

export function addVstScanDir(dir) {
  const trimmed = String(dir || '').trim();
  if (!trimmed) return getVstScanDirs();
  const dirs = [...new Set([...getVstScanDirs(), trimmed])];
  updateAudioSettings({ vstScanDirs: dirs });
  return dirs;
}

export function removeVstScanDir(dir) {
  const dirs = getVstScanDirs().filter((item) => item !== dir);
  updateAudioSettings({ vstScanDirs: dirs });
  return dirs;
}

function sameDirs(a, b) {
  const left = [...(a || [])].sort();
  const right = [...(b || [])].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function scanVstPluginsCached({ dirs, force = false, onProgress } = {}) {
  const scanDirs = dirs ?? getVstScanDirs();
  const cached = loadVstScanCache();
  if (
    !force &&
    cached.scannedAt > 0 &&
    Date.now() - cached.scannedAt < MAX_AGE_MS &&
    sameDirs(cached.dirs, scanDirs)
  ) {
    return cached;
  }

  const outcome = await scanVstPlugins({ dirs: scanDirs, onProgress });
  return saveVstScanCache({
    ...outcome,
    dirs: scanDirs,
    scannedAt: Date.now(),
  });
}

export function formatScanAge(scannedAt) {
  if (!scannedAt) return 'never scanned';
  const seconds = Math.max(0, Math.round((Date.now() - scannedAt) / 1000));
  if (seconds < 60) return 'scanned just now';
  if (seconds < 3600) return `scanned ${Math.round(seconds / 60)} min ago`;
  return `scanned ${Math.round(seconds / 3600)} h ago`;
}
