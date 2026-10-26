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
 *
 * FIXED — silent-preview race: once an element is routed through
 * createMediaElementSource, its audio can ONLY be heard through this
 * graph — the element's native output path is permanently disconnected
 * by the platform the moment that call is made, whether or not the
 * AudioContext is actually running yet. resumeAudioContext() used to be
 * called (and its promise ignored) AFTER ensureMediaGainChain/
 * setMediaElementVolume had already routed the element and after
 * el.play() had already been kicked off, so playback frequently started
 * while ctx.state was still 'suspended' — the element visibly "played"
 * (currentTime advancing, isPlaying true) with no sound reaching the
 * speakers until something else happened to resume the context later.
 * resumeAudioContext() now returns the resume promise, and callers await
 * it BEFORE creating the gain chain / calling play(), so audio is only
 * started once the context is actually 'running'.
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
 * 'suspended' until a user gesture. Returns a Promise that resolves once
 * the context is either already running or has finished resuming (or
 * immediately if Web Audio isn't available at all) — callers that are
 * about to route an element through the gain chain and start playback
 * MUST await this first, otherwise the element can end up routed through
 * a still-suspended context, which is silent even though play() succeeds.
 */
export function resumeAudioContext() {
  const ctx = getAudioContext();
  if (!ctx) return Promise.resolve();
  if (ctx.state === 'suspended') {
    return ctx.resume().catch(() => {});
  }
  return Promise.resolve();
}
 
// Samples per analysis window for the level meters. 1024 samples is ~21ms
// at 48kHz — short enough that transient peaks register, long enough to be
// cheap to read every animation frame.
const METER_FFT_SIZE = 1024;
 
// Floor for the meter scale. Anything at or below this reads as "silence".
export const METER_FLOOR_DB = -60;
 
// element -> { source, gain, analyser, trackId } (null means chain creation failed and we
// fell back to element.volume). WeakMap: keys are the media elements
// themselves, so elements removed by React drop out of the map
// automatically once their chain is disconnected.
const gainChains = new WeakMap();
 
// trackId -> Set<AnalyserNode>. The WeakMap above can't be iterated, so the
// meters need their own index. Entries are added when an element is tagged
// with a track and removed when it's retagged to another track or its chain
// is torn down (disconnectMediaGainChain), so it never holds a dead node.
const trackAnalysers = new Map();
 
function indexAnalyser(trackId, analyser) {
  if (trackId == null || !analyser) return;
  let set = trackAnalysers.get(trackId);
  if (!set) {
    set = new Set();
    trackAnalysers.set(trackId, set);
  }
  set.add(analyser);
}
 
function unindexAnalyser(trackId, analyser) {
  if (trackId == null || !analyser) return;
  const set = trackAnalysers.get(trackId);
  if (!set) return;
  set.delete(analyser);
  if (set.size === 0) trackAnalysers.delete(trackId);
}
 
/**
 * Route `el` through a GainNode once. Returns the gain node, or null if
 * Web Audio is unavailable / the element can't be routed (caller then falls
 * back to element.volume, which still works for 0–1).
 */
export function ensureMediaGainChain(el) {
  if (!el) return null;
  const existing = gainChains.get(el);
  if (existing !== undefined) {
    return existing ? existing.gain : null;
  }
  const ctx = getAudioContext();
  if (!ctx) {
    gainChains.set(el, null);
    return null;
  }
  try {
    const source = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(ctx.destination);
    // Level-meter tap: a passive side branch off the POST-gain signal, so
    // what the meter shows is what's actually being sent to the speakers
    // (mute/solo/fader all already applied). An AnalyserNode with no
    // output connection never touches the audible path.
    let analyser = null;
    try {
      analyser = ctx.createAnalyser();
      analyser.fftSize = METER_FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      gain.connect(analyser);
    } catch {
      analyser = null;
    }
    gainChains.set(el, { source, gain, analyser, trackId: null });
    // Once routed through the graph the element's own volume property is
    // bypassed — pin it at 1 so the gain node is the single volume control.
    el.volume = 1;
    return gain;
  } catch (err) {
    // e.g. the element is already routed, or the context is in a state that
    // refuses new sources — fall back to element.volume.
    gainChains.set(el, null);
    return null;
  }
}
 
/** Clip an authored volume to the supported 0–4 range (4 = +12 dB). */
export function clampVolume(volume) {
  const v = Number(volume);
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(4, v));
}
 
/**
 * Apply an authored volume (0–4) to a media element. Through the gain chain
 * when one can be created (the only path that can exceed 1.0); otherwise
 * falls back to element.volume for the 0–1 range.
 *
 * NOTE: this routes `el` through the Web Audio graph as a side effect
 * (see ensureMediaGainChain). Callers driving playback should call
 * resumeAudioContext() and wait for it to settle BEFORE calling this for
 * an element that's about to play — see the FIXED note at the top of this
 * file for why order matters here.
 */
export function setMediaElementVolume(el, volume, trackId) {
  if (!el) return;
  const v = clampVolume(volume);
  const gainNode = ensureMediaGainChain(el);
  if (gainNode) {
    // Remember which track this element feeds so the mixer can meter per
    // track. Optional: callers that don't pass one just aren't metered.
    if (trackId != null) {
      const chain = gainChains.get(el);
      if (chain && chain.trackId !== trackId) {
        unindexAnalyser(chain.trackId, chain.analyser);
        chain.trackId = trackId;
        indexAnalyser(trackId, chain.analyser);
      }
    }
    gainNode.gain.value = v;
    // When volume is 0, also mute the element so absolutely no sound leaks through
    el.muted = v === 0;
    if (v > 0) {
      el.volume = 1;
    }
  } else {
    el.volume = Math.max(0, Math.min(1, v));
    el.muted = v === 0;
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
    unindexAnalyser(chain.trackId, chain.analyser);
    try {
      chain.source.disconnect();
      chain.gain.disconnect();
      chain.analyser?.disconnect();
    } catch {
      // already disconnected
    }
    gainChains.delete(el);
  }
}
 
// Reused per-analyser scratch buffers so reading levels every animation
// frame allocates nothing.
const meterBuffers = new WeakMap();
 
function readAnalyserPeak(analyser) {
  let buf = meterBuffers.get(analyser);
  if (!buf) {
    buf = new Float32Array(analyser.fftSize);
    meterBuffers.set(analyser, buf);
  }
  analyser.getFloatTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = buf[i] < 0 ? -buf[i] : buf[i];
    if (a > peak) peak = a;
  }
  return peak;
}
 
/** Linear amplitude (1.0 = full scale) -> dBFS, floored at METER_FLOOR_DB. */
export function amplitudeToDb(amp) {
  if (!(amp > 0)) return METER_FLOOR_DB;
  const db = 20 * Math.log10(amp);
  return db < METER_FLOOR_DB ? METER_FLOOR_DB : db;
}
 
/**
 * Live peak level (dBFS) for one track: the loudest sample across every
 * media element currently routed to that track, in the last analysis
 * window. Returns METER_FLOOR_DB when nothing is playing on the track.
 * Values above 0 are possible (and meaningful — the fader goes to +12 dB,
 * and summed/boosted signal can exceed full scale): that's clipping.
 *
 * Note: this measures each element separately and takes the max, not the
 * true summed waveform of overlapping clips. Overlaps on one track are
 * rare, and peak-of-max is the conservative direction to be wrong in for
 * a clip warning.
 */
export function getTrackPeakDb(trackId) {
  if (trackId == null || typeof window === 'undefined') return METER_FLOOR_DB;
  // gainChains is a WeakMap (not iterable) by design so discarded elements
  // can be collected — track membership therefore lives in this Set index.
  const set = trackAnalysers.get(trackId);
  if (!set || set.size === 0) return METER_FLOOR_DB;
  let peak = 0;
  for (const analyser of set) {
    const p = readAnalyserPeak(analyser);
    if (p > peak) peak = p;
  }
  return amplitudeToDb(peak);
}