/**
 * Pure math for the mixer's fader and meters — no React, no Web Audio, so
 * it can be reasoned about (and tested) on its own.
 *
 * DATA MODEL: a track's `volume` stays exactly what it always was — a
 * LINEAR gain multiplier in [0, 4] where 1.0 is unity. Nothing here changes
 * what is stored or what resolveEffectiveVolume() multiplies by. dB is only
 * a way of DISPLAYING and DRAGGING that number: a fader is far more usable
 * on a log scale (equal fader travel = equal perceived loudness change)
 * than on the raw multiplier, where the whole quiet half of the range would
 * be squashed into a sliver at the bottom.
 *
 * The 0–4 range tops out at 20*log10(4) = +12.04 dB, which is where the
 * fader ends (FADER_MAX_DB).
 */
 
/** Below this the fader reads "-inf" and snaps to exactly 0 (silence). */
export const FADER_MIN_DB = -60;
/** 4.0x gain = +12.04 dB; the fader's top stop. */
export const FADER_MAX_DB = 20 * Math.log10(4);
/** Volume multiplier ceiling — mirrors clampVolume's authored 0–4 range. */
export const VOLUME_MAX = 4;
 
/** Linear gain -> dB. 0 (or negative/NaN) is -Infinity. */
export function gainToDb(gain) {
  if (!Number.isFinite(gain) || gain <= 0) return -Infinity;
  return 20 * Math.log10(gain);
}
 
/** dB -> linear gain. -Infinity (or anything at/below the floor) is 0. */
export function dbToGain(db) {
  if (!Number.isFinite(db) || db <= FADER_MIN_DB) return 0;
  return Math.pow(10, db / 20);
}
 
/**
 * Fader position (0 = bottom, 1 = top) for a linear gain.
 * The scale is linear in dB between FADER_MIN_DB and FADER_MAX_DB, so 0 dB
 * (unity, gain 1.0) sits at ~83% of the travel — the classic "most of the
 * throw is below unity, a little headroom above" layout.
 */
export function gainToFaderPos(gain) {
  const db = gainToDb(gain);
  if (db <= FADER_MIN_DB) return 0;
  const t = (db - FADER_MIN_DB) / (FADER_MAX_DB - FADER_MIN_DB);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
 
/** Inverse of gainToFaderPos. pos 0 returns exactly 0 (true silence). */
export function faderPosToGain(pos) {
  if (!Number.isFinite(pos) || pos <= 0) return 0;
  const p = pos > 1 ? 1 : pos;
  const db = FADER_MIN_DB + p * (FADER_MAX_DB - FADER_MIN_DB);
  return Math.min(VOLUME_MAX, dbToGain(db));
}
 
/** Fader position of unity gain (0 dB) — where the "0" tick is drawn. */
export const UNITY_FADER_POS = gainToFaderPos(1);
 
/**
 * Snap a gain to exactly 1.0 when it's within `toleranceDb` of unity, so a
 * drag "magnets" to 0 dB instead of forcing pixel-perfect aim.
 */
export function snapToUnity(gain, toleranceDb = 0.6) {
  const db = gainToDb(gain);
  return Math.abs(db) <= toleranceDb ? 1 : gain;
}
 
/** Text like "-6.0", "+3.5", "0.0", or "-inf" for a linear gain. */
export function formatGainDb(gain) {
  const db = gainToDb(gain);
  if (db === -Infinity || db <= FADER_MIN_DB) return '-inf';
  const rounded = Math.round(db * 10) / 10;
  // Avoid "-0.0".
  const v = Object.is(rounded, -0) || rounded === 0 ? 0 : rounded;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}
 
/** Text for a meter reading in dBFS (peak-hold readout). */
export function formatPeakDb(db) {
  if (!Number.isFinite(db) || db <= -60) return '-inf';
  const rounded = Math.round(db * 10) / 10;
  const v = Object.is(rounded, -0) || rounded === 0 ? 0 : rounded;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}
 
/**
 * Meter segment colour zone for a dBFS value. Thresholds follow the usual
 * DAW convention: green up to -18, amber to -6, hot orange to just under
 * full scale, and red at/above 0 dBFS (clipping).
 */
export function meterZone(db) {
  if (db >= 0) return 'clip';
  if (db >= -6) return 'hot';
  if (db >= -18) return 'warm';
  return 'ok';
}
 
/** Map a dBFS reading to 0..1 meter fill over [floorDb, +3]. */
export function dbToMeterFill(db, floorDb = -60, ceilDb = 3) {
  if (!Number.isFinite(db)) return 0;
  const t = (db - floorDb) / (ceilDb - floorDb);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}