/**
 * Shared Web Audio gain-chain helpers for live media elements
 * (<video>/<audio> in EntityRenderer.jsx's preview).
 *
 * WHY THIS EXISTS — volume beyond 1.0. HTMLMediaElement.volume is clamped
 * to [0, 1] by the platform (per spec, assigning outside the range throws
 * IndexSizeError; browsers in practice clamp or throw), so a clip's volume
 * can never be boosted past unity by writing element.volume. Boosting is
 * done with a GainNode instead: each media element is routed
 *
 *     element → MediaElementSourceNode → GainNode → AudioContext.destination
 *
 * exactly once (createMediaElementSource on an already-routed element
 * throws InvalidStateError, hence the per-element guard), and the gain
 * node's .gain.value carries the volume. Volume 0–1 sounds identical to
 * the old element.volume path (gain 1.0 == element volume 1.0); >1
 * actually amplifies. Clamped to 0–4 to keep the boost range sane.
 *
 * The AudioContext is created lazily and shared process-wide, and resumes
 * from the autoplay-policy 'suspended' state on playback gestures — the
 * same "construct on first need, resume on user activation" pattern the
 * rest of the app uses (see hooks/useAudioRecorder.js).
 */

// One shared context for the whole app — contexts are expensive and the
// browser caps how many can exist.
let sharedAudioCtx = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    sharedAudioCtx = new Ctor();
  }
  return sharedAudioCtx;
}

/**
 * Best-effort resume for autoplay policy: an AudioContext starts
 * 'suspended' until a user gesture. Called from the same tick as
 * play()/pause() so media routed through the graph starts audible.
 */
export function resumeAudioContext() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

// element -> { source, gain } (null means chain creation failed and we
// fell back to element.volume). WeakMap: keys are the media elements
// themselves, so elements removed by React drop out of the map
// automatically once their chain is disconnected.
const gainChains = new WeakMap();

// ─── TEMP DEBUG (volume-boost diagnosis; remove after root cause found) ────
const debugEvents = [];
const debugSeq = { n: 0 };
function dbg(label, extra = {}) {
  debugEvents.push({ at: performance.now().toFixed(0), seq: ++debugSeq.n, label, ...extra });
  // eslint-disable-next-line no-console
  console.log('[volboost]', label, extra);
}
// eslint-disable-next-line no-console
console.log('[volboost] module loaded');
// Exposed for DevTools inspection: window.__blahblahAudioDebug.getChains()
if (typeof window !== 'undefined') {
  window.__blahblahAudioDebug = {
    getEvents: () => debugEvents.slice(),
    getCtxState: () => (sharedAudioCtx ? sharedAudioCtx.state : 'no-ctx'),
    // TEMP: expose internals so automated tests can tap the chain (and
    // DevTools can inspect it directly). Remove with the rest of the debug.
    getCtx: () => sharedAudioCtx,
    getChain: (el) => gainChains.get(el) || null,
  };
}

/**
 * Route `el` through a GainNode once. Returns the gain node, or null if
 * Web Audio is unavailable / the element can't be routed (caller then falls
 * back to element.volume, which still works for 0–1).
 */
export function ensureMediaGainChain(el) {
  dbg('ensureMediaGainChain', { tag: el?.tagName, hasChain: gainChains.has(el) });
  if (!el) return null;
  const existing = gainChains.get(el);
  if (existing !== undefined) {
    return existing ? existing.gain : null;
  }
  const ctx = getAudioContext();
  if (!ctx) {
    dbg('ensureMediaGainChain: no AudioContext available', { tag: el.tagName });
    gainChains.set(el, null);
    return null;
  }
  try {
    const source = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(ctx.destination);
    gainChains.set(el, { source, gain });
    // Once routed through the graph the element's own volume property is
    // bypassed — pin it at 1 so the gain node is the single volume control.
    el.volume = 1;
    dbg('ensureMediaGainChain: CREATED', { tag: el.tagName, ctxState: ctx.state, gainValue: gain.gain.value });
    return gain;
  } catch (err) {
    // e.g. the element is already routed, or the context is in a state that
    // refuses new sources — fall back to element.volume.
    dbg('ensureMediaGainChain: FAILED', { tag: el.tagName, error: String(err), ctxState: ctx.state });
    gainChains.set(el, null);
    return null;
  }
}

/** Clip an authored volume to the supported 0–100 range. */
export function clampVolume(volume) {
  const v = Number(volume);
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(100, v));
}

/**
 * Apply an authored volume (0–4) to a media element. Through the gain chain
 * when one can be created (the only path that can exceed 1.0); otherwise
 * falls back to element.volume for the 0–1 range.
 */
export function setMediaElementVolume(el, volume) {
  if (!el) return;
  const v = clampVolume(volume);
  const gainNode = ensureMediaGainChain(el);
  if (gainNode) {
    gainNode.gain.value = v;
    // When volume is 0, also mute the element so absolutely no sound leaks through
    el.muted = v === 0;
    if (v > 0) {
      el.volume = 1;
    }
    dbg('setMediaElementVolume: gain set', {
      tag: el.tagName,
      requested: volume,
      v,
      ctxState: sharedAudioCtx?.state,
      gainValue: gainNode.gain.value,
      muted: el.muted,
    });
  } else {
    el.volume = Math.max(0, Math.min(1, v));
    el.muted = v === 0;
    dbg('setMediaElementVolume: element.volume fallback', {
      tag: el.tagName,
      requested: volume,
      v,
      elVolume: el.volume,
      muted: el.muted,
    });
  }
}

/**
 * Apply a media playback-rate (element.playbackRate). Rates outside the
 * platform-supported range are clamped to [0.0625, 16] — the values every
 * browser accepts (Chrome clamps instead of throwing, but staying inside
 * avoids per-browser surprises entirely).
 */
export function setMediaElementRate(el, rate) {
  if (!el) return;
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return;
  el.playbackRate = Math.max(0.0625, Math.min(16, r));
}

/**
 * Tear down an element's gain chain (disconnect source + gain so nothing
 * keeps the element alive through the graph). Call when a routed element is
 * discarded — e.g. a <video> unmounts because its clip left the active
 * window — so repeated activate/deactivate cycles don't accumulate
 * disconnected-but-still-referenced sources.
 */
export function disconnectMediaGainChain(el) {
  if (!el) return;
  const chain = gainChains.get(el);
  if (chain) {
    try {
      chain.source.disconnect();
      chain.gain.disconnect();
    } catch {
      // already disconnected
    }
    gainChains.delete(el);
  }
}
