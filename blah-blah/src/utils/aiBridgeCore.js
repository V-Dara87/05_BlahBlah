/**
 * AI Bridge Core Utilities.
 * Pure, environment-agnostic helper functions for the BlahBlah AI Bridge.
 * Can run safely in browser, Tauri webview, or Node.js unit tests.
 */

export const DEFAULT_MAX_COMMAND_AGE_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_FRAME_LONG_SIDE = 1280;

export const ALLOWED_BRIDGE_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'http://localhost:5173',
];

/**
 * Checks if the given Origin header is in the bridge allowlist.
 */
export function isOriginAllowed(origin) {
  if (!origin || typeof origin !== 'string') return false;
  const clean = origin.trim().replace(/\/+$/, '');
  return ALLOWED_BRIDGE_ORIGINS.includes(clean);
}

/**
 * Verifies that the command carries a valid bearer token matching the project token.
 * Prevents unauthorized local processes from sending commands to the editor.
 */
export function verifyBridgeToken(commandToken, expectedToken) {
  if (!expectedToken || typeof expectedToken !== 'string') return false;
  if (!commandToken || typeof commandToken !== 'string') return false;
  const a = commandToken.trim();
  const b = expectedToken.trim();
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Checks whether a command is stale (older than maxAgeMs, default 5 minutes).
 * On editor startup or after a sleep cycle, old commands in the inbox are dropped.
 */
export function isCommandStale(timestamp, now = Date.now(), maxAgeMs = DEFAULT_MAX_COMMAND_AGE_MS) {
  if (!timestamp || typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return true;
  }
  return now - timestamp > maxAgeMs;
}

/**
 * Resolves an entity target by ID or name against the active project entities.
 * Supports exact ID match, exact name match, and case-insensitive name match.
 */
export function findEntityForSelect(entities, target) {
  if (!Array.isArray(entities) || !target) return null;
  const str = String(target).trim();
  if (!str) return null;

  // 1. Exact ID
  const byId = entities.find((e) => e && e.id === str);
  if (byId) return byId;

  // 2. Exact Name
  const byName = entities.find((e) => e && typeof e.name === 'string' && e.name === str);
  if (byName) return byName;

  // 3. Case-insensitive Name
  const lower = str.toLowerCase();
  const byNameCi = entities.find((e) => e && typeof e.name === 'string' && e.name.toLowerCase() === lower);
  return byNameCi || null;
}

/**
 * Calculates downscaled output dimensions capped at `maxLongSide` (default 1280px)
 * to keep agent token consumption low while preserving aspect ratio.
 * Ensures output dimensions are even numbers (standard for PNG/video encoders).
 */
export function calculateDownscaleDimensions(width, height, maxLongSide = MAX_FRAME_LONG_SIDE) {
  const w = Number(width) > 0 ? Number(width) : 1920;
  const h = Number(height) > 0 ? Number(height) : 1080;
  const longSide = Math.max(w, h);

  let targetW = w;
  let targetH = h;
  if (longSide > maxLongSide) {
    const scale = maxLongSide / longSide;
    targetW = Math.round(w * scale);
    targetH = Math.round(h * scale);
  }

  // Ensure even dimensions >= 2
  targetW = Math.max(2, targetW - (targetW % 2));
  targetH = Math.max(2, targetH - (targetH % 2));

  return { width: targetW, height: targetH };
}

/**
 * Formats a standardized bridge response for the outbox.
 */
export function formatBridgeResult(id, ok, data = {}, error = null) {
  return {
    id: String(id || ''),
    ok: Boolean(ok),
    timestamp: Date.now(),
    ...data,
    ...(error ? { error: String(error) } : {}),
  };
}

/**
 * Converts a base64 string to a Uint8Array across browser and Node.js environments.
 */
export function base64ToUint8Array(base64) {
  if (typeof base64 !== 'string' || !base64) return new Uint8Array(0);
  const clean = base64.replace(/^data:image\/[a-z]+;base64,/, '').trim();
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(clean, 'base64'));
  }
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converts a Uint8Array to a base64 string across browser and Node.js environments.
 */
export function uint8ArrayToBase64(bytes) {
  if (!bytes || bytes.byteLength === 0) return '';
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
