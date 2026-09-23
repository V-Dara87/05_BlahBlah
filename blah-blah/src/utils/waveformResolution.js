/**
 * waveformResolution — how many envelope buckets to ask for, given the box a
 * waveform is drawn into.
 *
 * Shared by BOTH renderers (the DOM's per-clip WaveformCanvas and the canvas
 * timeline's drawWaveform) on purpose: the peak request key is
 * (url, numPeaks, window), so if the two asked for different bucket counts for
 * the same box, switching renderers — or comparing them — would re-slice every
 * clip's waveform for a box that is already showing one.
 *
 * Deliberately dependency-free so it can be imported from anywhere, including
 * the draw helpers that are unit-tested by plain `node` (which needs explicit
 * `.js` extensions and cannot follow the app's extensionless imports).
 */

/**
 * Envelope buckets per pixel of box width, as a function of the box's HEIGHT.
 *
 * A short/collapsed track (the default ~48px clip height) only needs ~1
 * bucket/px — any finer and the shape looks identical but costs more CPU. A
 * track the user has resized tall gets progressively more buckets/px, so
 * expanding a track keeps revealing real sample-level detail instead of just
 * scaling up the same coarse shape (the "make it very detailed like DaVinci
 * Resolve" ask).
 */
export function detailForHeight(height) {
  if (height <= 56) return 1; // compact/default clip height
  if (height <= 90) return 1.5;
  if (height <= 140) return 2.5;
  if (height <= 220) return 4;
  return 6; // fully expanded track — maximum envelope resolution
}

/** Smallest envelope any box asks for. */
export const MIN_WAVEFORM_BUCKETS = 128;
/** Largest envelope any box asks for (see bucketsForCard). */
export const MAX_WAVEFORM_BUCKETS = 16384;

/**
 * Bucket count to request for a box of this pixel size.
 *
 * Rounded UP to a power of two, inside a floor and a ceiling, for three
 * reasons:
 *
 *   1. A box's width changes continuously while zooming and while dragging a
 *      trim handle. Asking for exactly `width * detail` gave a NEW cache key —
 *      and a fresh, async envelope — on almost every frame of a zoom, so every
 *      waveform kept swapping to the "still working" placeholder and back (the
 *      reported "waveform looks like it reloads while zooming"). On the ladder
 *      a whole range of zoom levels shares one envelope; a 2x zoom step is when
 *      the request actually changes.
 *   2. Rounding UP never asks for less detail than the box can draw, whereas
 *      rounding to the nearest rung would make zoomed-in waveforms coarser than
 *      the box they are drawn into.
 *   3. It bounds the cost: 3 x buckets x 4 bytes per envelope, plus the slice
 *      loop that fills it. A 1-hour clip at 200 px/s is a 720000px box — with
 *      no ceiling that is a ~8.6 MB envelope per clip, re-sliced on every zoom
 *      step. Renderers draw only the buckets that are on screen (see
 *      drawWaveformEnvelope's view culling), so the ceiling costs resolution
 *      only on boxes far wider than the viewport.
 */
export function bucketsForCard(width, height) {
  const raw = Math.min(
    MAX_WAVEFORM_BUCKETS,
    Math.max(1, Math.round((Number.isFinite(width) ? width : 0) * detailForHeight(height)))
  );
  const rung = 2 ** Math.ceil(Math.log2(Math.max(MIN_WAVEFORM_BUCKETS, raw)));
  return Math.min(MAX_WAVEFORM_BUCKETS, rung);
}
