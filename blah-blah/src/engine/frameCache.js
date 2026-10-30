/**
 * FrameCache - RAM Preview Frame Cache for BlahBlah scripts.
 *
 * Inspired by After Effects' RAM Preview and modern game engine texture caches.
 *
 * How it works:
 * 1. When a procedural canvas script renders a frame at a given timeline position,
 *    a snapshot of the canvas is stored in an in-memory LRU ring buffer.
 * 2. When scrubbing or replaying, if the identical (entity, script, props, frame) key
 *    hits the cache, the script's `draw()` is skipped entirely and the cached
 *    frame is blitted (copied) in microseconds.
 * 3. Editing code or changing inspector props invalidates the cache for that entity.
 */

const DEFAULT_MAX_CACHED_FRAMES = 180; // ~6 seconds at 30fps
// Frames are full-size canvases (width x height x 4 bytes): 180 of them at 4K
// would be ~6 GB. The byte budget keeps memory bounded whatever the resolution.
const DEFAULT_MAX_CACHED_BYTES = 256 * 1024 * 1024;

// Hashing a whole script's source char-by-char on EVERY frame is wasteful; the
// source rarely changes, so remember the hash per code string.
const codeHashMemo = new Map();
const CODE_HASH_MEMO_LIMIT = 64;

function memoCodeHash(code) {
  const key = code || '';
  let hash = codeHashMemo.get(key);
  if (hash === undefined) {
    hash = fastStringHash(key);
    if (codeHashMemo.size >= CODE_HASH_MEMO_LIMIT) codeHashMemo.clear();
    codeHashMemo.set(key, hash);
  }
  return hash;
}

function fastStringHash(str) {
  let hash = 5381;
  const len = str.length;
  for (let i = 0; i < len; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

// props objects come from immutable project state (edits create a new object),
// so the hash can be remembered per object instead of re-serialising every frame.
const propsHashMemo = new WeakMap();

function hashProps(props) {
  if (!props || typeof props !== 'object') return '0';
  const cached = propsHashMemo.get(props);
  if (cached !== undefined) return cached;
  let hash;
  try {
    hash = fastStringHash(JSON.stringify(props));
  } catch {
    hash = '0';
  }
  propsHashMemo.set(props, hash);
  return hash;
}

export class FrameCache {
  constructor(maxFrames = DEFAULT_MAX_CACHED_FRAMES, maxBytes = DEFAULT_MAX_CACHED_BYTES) {
    this.maxFrames = maxFrames;
    this.maxBytes = maxBytes;
    this.totalBytes = 0;
    this.cache = new Map(); // key -> { canvas, width, height, lastUsed, entityId, bytes }
    this.entityToKeys = new Map(); // entityId -> Set of keys
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Generates a deterministic composite key for a single frame snapshot.
   * `timingKey` must capture anything else the frame depends on, such as the
   * clip's duration and start (progress / timeLeft / timelineTime derive from
   * them) — otherwise a trimmed or moved clip would show stale frames.
   */
  generateKey(entityId, scriptId, scriptCode, props, frame, width, height, timingKey = '') {
    const codeHash = memoCodeHash(scriptCode);
    const pHash = hashProps(props);
    const timing = timingKey === '' ? '' : `::t${timingKey}`;
    return `${entityId}::${scriptId || 's'}::${codeHash}::${pHash}::f${frame}::${width}x${height}${timing}`;
  }

  /**
   * Retrieves a cached frame if available.
   * @param {string} key
   * @returns {{ canvas: any, width: number, height: number } | null}
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    // Refresh LRU recency
    this.cache.delete(key);
    entry.lastUsed = Date.now();
    this.cache.set(key, entry);
    this.hits++;
    return entry;
  }

  /**
   * Stores a frame canvas snapshot into the cache.
   * @param {string} entityId
   * @param {string} key
   * @param {HTMLCanvasElement | any} sourceCanvas
   * @param {number} width
   * @param {number} height
   */
  set(entityId, key, sourceCanvas, width, height) {
    if (!sourceCanvas || width <= 0 || height <= 0) return;

    // Create an offscreen buffer canvas if running in browser / environment with createElement
    let copyCanvas = null;
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      copyCanvas = document.createElement('canvas');
      copyCanvas.width = width;
      copyCanvas.height = height;
      const ctx = copyCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(sourceCanvas, 0, 0);
      }
    } else {
      // In headless test environments or when mock canvas is passed
      copyCanvas = { width, height, __mock: true };
    }

    // Replacing an existing key must release the old entry's bytes first.
    if (this.cache.has(key)) this.delete(key);

    const bytes = width * height * 4;
    // A single frame larger than the whole budget is never cached.
    if (bytes > this.maxBytes) {
      if (!copyCanvas.__mock) copyCanvas.width = 0;
      return;
    }

    // Evict oldest until both the frame-count and the byte budget have room.
    while (
      this.cache.size > 0 &&
      (this.cache.size >= this.maxFrames || this.totalBytes + bytes > this.maxBytes)
    ) {
      const oldestKey = this.cache.keys().next().value;
      this.delete(oldestKey);
    }

    this.cache.set(key, { canvas: copyCanvas, width, height, lastUsed: Date.now(), entityId, bytes });
    this.totalBytes += bytes;

    // Track keys per entity for quick invalidation
    if (!this.entityToKeys.has(entityId)) {
      this.entityToKeys.set(entityId, new Set());
    }
    this.entityToKeys.get(entityId).add(key);
  }

  /**
   * Blits a cached frame directly to target context.
   * @param {CanvasRenderingContext2D | any} targetCtx
   * @param {{ canvas: any, width: number, height: number }} cachedFrame
   * @returns {boolean} True if successfully blitted
   */
  blit(targetCtx, cachedFrame) {
    if (!targetCtx || !cachedFrame?.canvas) return false;
    try {
      if (typeof targetCtx.drawImage === 'function') {
        targetCtx.clearRect(0, 0, cachedFrame.width, cachedFrame.height);
        targetCtx.drawImage(cachedFrame.canvas, 0, 0);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  delete(key) {
    const entry = this.cache.get(key);
    if (!entry) return;
    this.cache.delete(key);
    this.totalBytes = Math.max(0, this.totalBytes - (entry.bytes || 0));
    // Drop the key from the per-entity index too, so evicted frames don't leave
    // ever-growing key sets behind.
    const keys = this.entityToKeys.get(entry.entityId);
    if (keys) {
      keys.delete(key);
      if (keys.size === 0) this.entityToKeys.delete(entry.entityId);
    }
    // Release the canvas backing store right away instead of waiting for GC.
    if (entry.canvas && !entry.canvas.__mock && typeof entry.canvas.width === 'number') {
      entry.canvas.width = 0;
    }
  }

  /**
   * Invalidates all cached frames for a given entity (e.g. when code or props change).
   */
  invalidateEntity(entityId) {
    const keys = this.entityToKeys.get(entityId);
    if (!keys) return;
    for (const key of [...keys]) {
      this.delete(key);
    }
    this.entityToKeys.delete(entityId);
  }

  /**
   * Clears all cached frames.
   */
  clear() {
    for (const key of [...this.cache.keys()]) this.delete(key);
    this.cache.clear();
    this.entityToKeys.clear();
    this.totalBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Returns current statistics for debugging / UI indicators.
   */
  getStats() {
    return {
      size: this.cache.size,
      maxFrames: this.maxFrames,
      bytes: this.totalBytes,
      maxBytes: this.maxBytes,
      hits: this.hits,
      misses: this.misses,
      hitRatio: this.hits + this.misses > 0 ? (this.hits / (this.hits + this.misses)).toFixed(2) : '0.00',
    };
  }
}

// Global default singleton instance shared across the editor timeline
export const globalFrameCache = new FrameCache();