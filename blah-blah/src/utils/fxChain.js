/**
 * Pure helpers for a track's VST3 insert chain.
 *
 * This module is deliberately free of React and Tauri imports so the chain
 * shape can be unit-tested and the project loader can normalize old projects
 * without starting the sidecar.
 */

export const MAX_FX_SLOTS = 8;
export const FX_FORMAT_VST3 = 'vst3';
export const FX_STATE_DIR = 'fx';

const CLASS_ID_RE = /^[0-9a-f]{32}$/i;

function makeId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validate and normalize one serialized slot. Invalid slots are dropped rather
 * than allowed to reach the sidecar with a malformed class id or path.
 */
export function normalizeFxSlot(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const pluginPath = cleanString(raw.pluginPath);
  const classId = cleanString(raw.classId).toLowerCase();
  if (!pluginPath || !CLASS_ID_RE.test(classId)) return null;
  const stateFile = cleanString(raw.stateFile);
  return {
    id: cleanString(raw.id) || `fx-${index}-${makeId()}`,
    format: FX_FORMAT_VST3,
    pluginPath,
    classId,
    name: cleanString(raw.name) || pluginPath.split(/[\\/]/).pop()?.replace(/\.vst3$/i, '') || 'VST3 plugin',
    vendor: cleanString(raw.vendor),
    bypass: raw.bypass === true,
    stateFile: stateFile || null,
    stateHash: cleanString(raw.stateHash) || null,
  };
}

/** Normalize a track's FX fields without mutating the track. */
export function normalizeTrackFx(track) {
  if (!track || typeof track !== 'object') return track;
  const fx = Array.isArray(track.fx)
    ? track.fx.map((slot, index) => normalizeFxSlot(slot, index)).filter(Boolean).slice(0, MAX_FX_SLOTS)
    : [];
  return { ...track, fx, fxBypassAll: track.fxBypassAll === true };
}

/** Build a new slot from one scan result. */
export function createFxSlot(plugin) {
  const id = makeId();
  return normalizeFxSlot({
    id,
    format: FX_FORMAT_VST3,
    pluginPath: plugin?.path || plugin?.pluginPath,
    classId: plugin?.classId,
    name: plugin?.name,
    vendor: plugin?.vendor,
    bypass: false,
    stateFile: `${FX_STATE_DIR}/${id}.bin`,
    stateHash: null,
  });
}

export function isFxChainActive(track) {
  return !!track && !track.fxBypassAll && Array.isArray(track.fx) && track.fx.length > 0;
}

export function activeFxSlots(track) {
  if (!isFxChainActive(track)) return [];
  return track.fx.filter((slot) => slot && !slot.bypass);
}

/** Join a project-relative state path onto the project folder. */
export function joinProjectPath(projectPath, relativePath) {
  if (!projectPath) return null;
  const root = String(projectPath).replace(/[\\/]+$/, '');
  const rel = String(relativePath || '').replace(/^[\\/]+/, '');
  return `${root}/${rel}`;
}

export function absoluteStateFile(stateFile, projectPath) {
  if (!stateFile) return null;
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(stateFile)) return stateFile;
  return joinProjectPath(projectPath, stateFile);
}

/**
 * The sidecar's ChainSpec shape. `stateFile` is absolute because the sidecar
 * must open it directly; the project stores the relative form.
 */
export function serializeFxChain(track, projectPath) {
  return (track?.fx || []).map((slot) => ({
    plugin: slot.pluginPath,
    classId: slot.classId,
    stateFile: absoluteStateFile(slot.stateFile, projectPath),
    bypass: slot.bypass === true,
  }));
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/** FNV-1a fallback for environments without WebCrypto. */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function hashText(text) {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const bytes = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
    }
  } catch {
    // fall through
  }
  return fnv1a(text);
}

export async function hashBytes(bytes) {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
    }
  } catch {
    // fall through
  }
  let text = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  for (let i = 0; i < view.length; i++) text += String.fromCharCode(view[i]);
  return fnv1a(text);
}

/** Stable cache key for an exact chain + render range + source layout. */
export async function fxCacheKey({ track, chain, startTime, duration, sampleRate, entities, stateToken = '' }) {
  const sources = (entities || [])
    .map((entity) => ({
      id: entity.id,
      startTime: entity.startTime,
      duration: entity.duration,
      src: entity.src,
      components: (entity.components || []).map((component) => ({
        type: component.type,
        src: component.src,
        mediaOffset: component.mediaOffset,
        speed: component.speed,
        volume: component.volume,
      })),
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return hashText(stableStringify({
    trackId: track?.id,
    chain,
    stateToken,
    startTime: Number(startTime.toFixed(6)),
    duration: Number(duration.toFixed(6)),
    sampleRate,
    sources,
  }));
}
