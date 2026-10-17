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

function fastStringHash(str) {
  let hash = 5381;
  const len = str.length;
  for (let i = 0; i < len; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

function hashProps(props) {
  if (!props || typeof props !== 'object') return '0';
  try {
    return fastStringHash(JSON.stringify(props));
  } catch {
    return '0';
  }
}

export class FrameCache {
  constructor(maxFrames = DEFAULT_MAX_CACHED_FRAMES) {
    this.maxFrames = maxFrames;
    this.cache = new Map(); // key -> { canvas, width, height, lastUsed }
    this.entityToKeys = new Map(); // entityId -> Set of keys
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Generates a deterministic composite key for a single frame snapshot.
   */
  generateKey(entityId, scriptId, scriptCode, props, frame, width, height) {
    const codeHash = fastStringHash(scriptCode || '');
    const pHash = hashProps(props);
    return `${entityId}::${scriptId || 's'}::${codeHash}::${pHash}::f${frame}::${width}x${height}`;
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

    // Evict oldest if limit reached
    if (this.cache.size >= this.maxFrames) {
      const oldestKey = this.cache.keys().next().value;
      this.delete(oldestKey);
    }

    this.cache.set(key, { canvas: copyCanvas, width, height, lastUsed: Date.now() });

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
    this.cache.delete(key);
  }

  /**
   * Invalidates all cached frames for a given entity (e.g. when code or props change).
   */
  invalidateEntity(entityId) {
    const keys = this.entityToKeys.get(entityId);
    if (!keys) return;
    for (const key of keys) {
      this.cache.delete(key);
    }
    this.entityToKeys.delete(entityId);
  }

  /**
   * Clears all cached frames.
   */
  clear() {
    this.cache.clear();
    this.entityToKeys.clear();
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
      hits: this.hits,
      misses: this.misses,
      hitRatio: this.hits + this.misses > 0 ? (this.hits / (this.hits + this.misses)).toFixed(2) : '0.00',
    };
  }
}

// Global default singleton instance shared across the editor timeline
export const globalFrameCache = new FrameCache();
