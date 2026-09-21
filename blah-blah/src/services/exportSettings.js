import { FFMPEG_FORMATS, FFMPEG_QUALITY_PRESETS } from './ffmpegExportRunner';
 
/**
 * Persisted default export options (Settings modal -> "Export" tab, added in
 * the next step). Global (not per project) and kept in localStorage, same
 * pattern as autosaveSettings.js.
 *
 * These are only the STARTING values of the Export dialog: ExportModal still
 * lets you change everything for a single export. Every default below is what
 * that dialog opens with today, so loading the defaults changes nothing.
 *
 *  - resolutionPreset  'project' | '720p' | '1080p' | '4k'.
 *                      'project' means "the project's own resolution" and is
 *                      the real default. ExportModal falls back to '1080p'
 *                      only when a project has no resolution set, and the
 *                      consumer must keep doing that for 'project'.
 *  - fps               24 | 30 | 60. (ExportModal keeps this as a string like
 *                      '30' in its state; convert with String() when reading.)
 *  - quality           'standard' | 'high' | 'ultra'. Bitrate preset for the
 *                      built-in WebCodecs engine (4 / 8 / 16 Mbps).
 *  - engine            'webcodecs' | 'ffmpeg'. Stored as a preference only: a
 *                      saved 'ffmpeg' is safe on a machine without the
 *                      sidecar, because ExportModal only uses FFmpeg when it
 *                      is running in the desktop app AND the sidecar answers.
 *  - ffmpegFormat      An id from FFMPEG_FORMATS (mp4_h264, mp4_hevc, ...).
 *  - ffmpegQuality     An id from FFMPEG_QUALITY_PRESETS (ultra, high, ...).
 *
 * The two FFmpeg lists are read from ffmpegExportRunner.js on every call
 * instead of being copied here, so adding a format there makes it valid here
 * automatically.
 */
 
const STORAGE_KEY = 'blahblah.exportSettings.v1';
 
export const EXPORT_RESOLUTION_PRESETS = Object.freeze(['project', '720p', '1080p', '4k']);
export const EXPORT_FPS_OPTIONS = Object.freeze([24, 30, 60]);
export const EXPORT_QUALITY_OPTIONS = Object.freeze(['standard', 'high', 'ultra']);
export const EXPORT_ENGINES = Object.freeze(['webcodecs', 'ffmpeg']);
 
export const EXPORT_DEFAULTS = Object.freeze({
  resolutionPreset: 'project',
  fps: 30,
  quality: 'high',
  engine: 'webcodecs',
  ffmpegFormat: 'mp4_h264',
  ffmpegQuality: 'high',
});
 
/** `value` if it is one of `allowed`, otherwise `fallback`. */
function pickOne(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}
 
/** Coerce any stored/partial value into a complete, valid settings object. */
export function sanitizeExportSettings(candidate) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
 
  // Accept 30 or '30' (a hand-edited or older value), but not '', null or true.
  const fpsCandidate =
    typeof c.fps === 'string' && c.fps.trim() !== '' ? Number(c.fps) : c.fps;
 
  return {
    resolutionPreset: pickOne(
      c.resolutionPreset,
      EXPORT_RESOLUTION_PRESETS,
      EXPORT_DEFAULTS.resolutionPreset
    ),
    fps: pickOne(fpsCandidate, EXPORT_FPS_OPTIONS, EXPORT_DEFAULTS.fps),
    quality: pickOne(c.quality, EXPORT_QUALITY_OPTIONS, EXPORT_DEFAULTS.quality),
    engine: pickOne(c.engine, EXPORT_ENGINES, EXPORT_DEFAULTS.engine),
    ffmpegFormat: pickOne(
      c.ffmpegFormat,
      Object.keys(FFMPEG_FORMATS),
      EXPORT_DEFAULTS.ffmpegFormat
    ),
    ffmpegQuality: pickOne(
      c.ffmpegQuality,
      Object.keys(FFMPEG_QUALITY_PRESETS),
      EXPORT_DEFAULTS.ffmpegQuality
    ),
  };
}
 
export function loadExportSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EXPORT_DEFAULTS };
    return sanitizeExportSettings(JSON.parse(raw));
  } catch {
    return { ...EXPORT_DEFAULTS };
  }
}
 
/** Persists and returns the sanitized settings that were actually stored. */
export function saveExportSettings(settings) {
  const sanitized = sanitizeExportSettings(settings);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage errors (private browsing, quota, etc.)
  }
  return sanitized;
}