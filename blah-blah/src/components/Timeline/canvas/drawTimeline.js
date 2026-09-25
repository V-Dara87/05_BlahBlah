/**
 * drawTimeline — everything the canvas timeline paints, in one pure pass.
 *
 * Reads the scene (utils/timelineScene.js) and draws the VISIBLE range only:
 * the caller passes the viewport (scroll offset + size) and this clips to it,
 * so cost tracks the number of clips on screen rather than the number of clips
 * in the project.
 *
 * Colours come from the same CSS custom properties and the same literal values
 * the DOM timeline uses (clip-item.css's per-category card colours, the
 * `--unity-*` palette from index.css, the lane grid/divider greys from
 * track-lane.css) so the two renderers look identical. They are read ONCE per
 * theme build (readTimelineTheme) instead of per frame — getComputedStyle is
 * the expensive part, and the palette never changes mid-drag.
 *
 * The DOM it replaces is ClipItem.jsx / TrackLane.jsx / TimeRuler.jsx; this
 * file mirrors their visual states (selected / locked / missing media / linked
 * parent-child / transition strip / silence-cut overlay / export-range dimming
 * / live-recording preview).
 */
import { getTickIntervalSeconds } from '../../../utils/timelineLayout.js';
import { cursorForZone, TRIM_HANDLE_WIDTH_PX } from '../../../utils/timelineScene.js';
import { drawWaveformEnvelope, drawWaveformPlaceholder } from './drawWaveform.js';

/**
 * Fallbacks used when a CSS variable is missing (identical to the CSS defaults).
 *
 * The lane colours are the DOM's own values, {
 *   - `laneBackground` is `.track-lane-row`'s `rgba(28, 28, 32, 0.4)`
 *     composited over `--unity-darkest` (#191919), since a canvas cannot layer
 *     a translucent fill over a background it does not control and the
 *     pre-multiplied result is what the eye actually sees. With a DOM present
 *     that composite is derived from the LIVE backdrop (see laneBackgroundFor),
 *     so an Appearance background tint/depth re-themes the lanes too; this is
 *     only the shipped-backdrop result.
 *   - `laneLockedA/B` are `.track-lane-row.lane-locked`'s repeating 45deg
 *     gradient bands (rgba(22,22,26,0.6) / rgba(28,28,34,0.6), 10px each).
 *   - `gridLine` is `.track-grid-pattern`'s line colour, and `divider` is
 *     `.track-divider-line`'s.
 */
const FALLBACK = Object.freeze({
  panel: '#282828',
  dark: '#1f1f1f',
  darkest: '#191919',
  subtle: '#323232',
  border: '#1a1a1a',
  text: '#d2d2d2',
  textDim: '#6e6e6e',
  accent: '#2c5d88',
  // The theme's bright accent (Settings -> Appearance). Both the hex and its
  // bare RGB channels are read, because canvas needs a resolved colour: it
  // cannot paint `rgba(var(--unity-accent-rgb), 0.55)` the way CSS can.
  accentBright: '#38bdf8',
  accentRgb: '56, 189, 248',
  gridLine: 'rgba(255, 255, 255, 0.14)',
  divider: 'rgba(255, 255, 255, 0.14)',
  laneBackground: '#1a1a1c',
  laneLockedA: 'rgba(22, 22, 26, 0.6)',
  laneLockedB: 'rgba(28, 28, 34, 0.6)',
  // The audio waveform's channels; the shipped violet is
  // `rgba(139, 92, 246, 0.55)` (see services/themeSettings.js).
  waveformRgb: '139, 92, 246',
});

/**
 * `.track-lane-row`'s own background, painted OVER `.timeline-scroll-area`'s
 * `background: var(--unity-darkest)` — a lane's apparent colour is the two
 * composited.
 */
const LANE_OVERLAY_RGB = [28, 28, 32];
const LANE_OVERLAY_ALPHA = 0.4;

/** `#rrggbb` -> `[r, g, b]`, or null when it is not a plain hex colour. */
function parseHexColor(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The unlocked-lane colour for the backdrop the theme currently applies.
 *
 * The whole app is themed by writing custom properties on <html>, but canvas
 * has no `var()` and `.track-lane-row` is translucent, so the canvas has to
 * paint the pre-multiplied result itself. Deriving it from the live
 * `--unity-darkest` (rather than keeping the shipped #1a1a1c constant) is what
 * makes Settings -> Appearance's Background tint/depth reach the canvas
 * timeline — with the constant, picking a preset re-themed the rest of the app
 * and the DOM timeline while the canvas lanes stayed the old grey.
 */
function laneBackgroundFor(darkest) {
  const base = parseHexColor(darkest);
  if (!base) return FALLBACK.laneBackground;
  const blend = (channel, index) =>
    Math.round(channel * (1 - LANE_OVERLAY_ALPHA) + LANE_OVERLAY_RGB[index] * LANE_OVERLAY_ALPHA);
  const [r, g, b] = base.map(blend);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Per-category card colours, copied from clip-item.css
 * (`.timeline-clip-card.video/.audio/.text/.shape/.prefab`).
 *
 * These are the DEFAULTS: with a DOM present, readTimelineTheme() reads the
 * live `--clip-<category>-bg` / `--clip-<category>-accent` instead, so the
 * canvas timeline follows whatever clip palette Settings -> Appearance has
 * applied. Kept exported because they are also the no-DOM fallback the tests
 * assert against.
 */
export const CARD_STYLE = Object.freeze({
  video: { background: '#1a2744', accent: '#3b82f6' },
  audio: { background: '#1a2233', accent: '#8b5cf6' },
  text: { background: '#2a2218', accent: '#f59e0b' },
  shape: { background: '#1a2a22', accent: '#10b981' },
  prefab: { background: '#2a1a2a', accent: '#ec4899' },
});

/** `--clip-<category>-bg` / `--clip-<category>-accent` for one category. */
function clipCssVars(category) {
  return { background: `--clip-${category}-bg`, accent: `--clip-${category}-accent` };
}

// The selection/hover/linked-child colours are the THEME's accent, read per
// build into `theme.accentBright` / `theme.accentRgb` (see readTimelineTheme).
// The constants below are only the values they fall back to with no DOM and
// the values `:root` ships, kept exported for callers that want the default.
export const SELECTED_COLOR = '#38bdf8';
export const MISSING_MEDIA_COLOR = '#f59e0b';
export const TRANSITION_COLOR = '#f59e0b';
export const TRANSITION_SELECTED_COLOR = '#fbbf24';
export const TRANSITION_ORPHAN_COLOR = '#ef4444';
export const RECORDING_COLOR = '#ef4444';
export const LINKED_CHILD_COLOR = '#38bdf8';
export const LINKED_PARENT_COLOR = '#f59e0b';
export const HOVER_COLOR = 'rgba(56, 189, 248, 0.55)';
export const DEFAULT_CARD_BORDER = 'rgba(0, 0, 0, 0.55)';

/**
 * The theme's bright accent at a given alpha, as a canvas-ready rgba() string.
 * Canvas has no `var()`, so translucent accents have to be assembled here from
 * the RGB channels read off `:root`.
 */
function accentWithAlpha(theme, alpha) {
  return `rgba(${theme?.accentRgb || FALLBACK.accentRgb}, ${alpha})`;
}
/** `.clip-title-text` colour — the card name, not the tooltip. */
export const CARD_TITLE_COLOR = '#ffffff';
/** The DOM's `🔒` badge / the lock glyph colour. */
export const LOCK_GLYPH_COLOR = 'rgba(210, 210, 210, 0.85)';
/** `.type-icon` glyph per category, standing in for the lucide icon in the DOM. */
const CATEGORY_GLYPH = Object.freeze({ video: '▶', audio: '♪', text: 'T', shape: '■', prefab: '❖' });
const RULER_TICK_COLOR = 'rgba(255, 255, 255, 0.35)';
export { RULER_TICK_COLOR };

/**
 * Read the palette off a DOM element once. Safe to call with no element (tests,
 * SSR) — every value falls back to the CSS literal.
 */
export function readTimelineTheme(el) {
  if (!el || typeof getComputedStyle !== 'function') return { ...FALLBACK, cards: CARD_STYLE };
  const cs = getComputedStyle(el);
  const read = (name, fallback) => {
    const value = cs.getPropertyValue(name);
    return value && value.trim() ? value.trim() : fallback;
  };
  // Clip colours are themed per category, so they are read the same way the
  // chrome is: the DOM's values when there is a DOM, the shipped literals when
  // there is not (tests, SSR).
  const cards = Object.fromEntries(
    Object.keys(CARD_STYLE).map((category) => {
      const vars = clipCssVars(category);
      return [
        category,
        {
          background: read(vars.background, CARD_STYLE[category].background),
          accent: read(vars.accent, CARD_STYLE[category].accent),
        },
      ];
    })
  );

  const darkest = read('--unity-darkest', FALLBACK.darkest);

  return {
    panel: read('--unity-panel', FALLBACK.panel),
    dark: read('--unity-dark', FALLBACK.dark),
    darkest,
    subtle: read('--unity-subtle', FALLBACK.subtle),
    border: read('--unity-border', FALLBACK.border),
    text: read('--unity-text', FALLBACK.text),
    textDim: read('--unity-text-dim', FALLBACK.textDim),
    accent: read('--unity-accent', FALLBACK.accent),
    accentBright: read('--unity-accent-blue', FALLBACK.accentBright),
    accentRgb: read('--unity-accent-rgb', FALLBACK.accentRgb),
    waveformRgb: read('--unity-waveform-rgb', FALLBACK.waveformRgb),
    gridLine: FALLBACK.gridLine,
    divider: FALLBACK.divider,
    laneBackground: laneBackgroundFor(darkest),
    laneLockedA: FALLBACK.laneLockedA,
    laneLockedB: FALLBACK.laneLockedB,
    cards,
  };
}

/**
 * Draw the whole visible timeline.
 *
 * @param {CanvasRenderingContext2D} ctx  already DPR-scaled by the caller
 * @param {object} params
 * @param {object} params.scene            buildTimelineScene() result
 * @param {object} params.theme            readTimelineTheme() result
 * @param {{scrollLeft:number, scrollTop:number, width:number, height:number}} params.view
 * @param {object} [params.state]
 * @param {Set<string>|Array<string>} [params.state.selectedIds]
 * @param {object|null} [params.state.exportRange] {in, out} seconds
 * @param {{x0:number,y0:number,x1:number,y1:number}|null} [params.state.lasso] content-space box
 * @param {object|null} [params.state.hover] {clipId, zone} | {trackId} | null
 * @param {object|null} [params.state.recording] {trackId, startTime, level}
 * @param {Map<string, object>} [params.state.silenceCuts] clipId -> cuts[]
 * @param {(item: object) => object|null} [params.state.peaksFor] envelope lookup for a clip
 * @param {(item: object) => boolean} [params.state.peaksPending] true while THAT clip's peaks are still being built
 * @returns {{ drawnClips: number }}
 */
export function drawTimelineScene(ctx, {
  scene,
  theme = { ...FALLBACK, cards: CARD_STYLE },
  view,
  state = {},
}) {
  const { scrollLeft, scrollTop, width, height } = view;
  const selected = new Set(state.selectedIds || []);
  const pps = scene.pixelsPerSecond;

  ctx.save();
  // NOTE: the base transform is the CALLER's (TimelineCanvas scales it by
  // devicePixelRatio so the backing store is crisp on HiDPI screens). This
  // function must not reset it — doing so drew everything at 1:1 device pixels
  // and a 2x display showed the timeline at half size in the top-left corner.
  // Everything below is in CSS pixels, offset by the scroll position so callers
  // never have to translate their own geometry. clearRect here therefore wipes
  // the whole (DPR-scaled) canvas, in the same units.
  ctx.clearRect(0, 0, width, height);
  ctx.translate(-scrollLeft, -scrollTop);

  // Clip to the visible viewport: with thousands of clips, offscreen drawing
  // is the whole cost we are trying to avoid.
  ctx.beginPath();
  ctx.rect(scrollLeft, scrollTop, width, height);
  ctx.clip();

  drawLaneBackground(ctx, { scene, theme, view });
  drawGrid(ctx, { scene, theme, view, pps });

  // Export-range dimming belongs BEHIND the cards, matching the DOM timeline
  // (.export-range-dim has a lower z-index than .timeline-clip-card), so an
  // out-of-range clip still reads as a clip rather than being tinted over.
  if (state.exportRange) drawExportRange(ctx, { exportRange: state.exportRange, view, pps });

  const visible = scene.itemsInRange(scene.xToTime(scrollLeft), scene.xToTime(scrollLeft + width));
  // Cards first, transition strips on top (they are overlays on the cut).
  const cards = visible.filter((i) => i.kind !== 'transition');
  const transitions = visible.filter((i) => i.kind === 'transition');

  ctx.font = '11px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textBaseline = 'middle';

  // "Is this card a parent of something selected / a child of something
  // selected?" (the cyan/amber dashed borders in clip-item.css). Both are
  // answered from the SAME draw-time selection set, derived from the selected
  // ids alone: for each selected clip, its parent id is a parent-of-selected.
  // ClipItem answers this per card with its own `allClips.some(...)` scan, which
  // would be O(visible x clips) on EVERY frame here — and scanning all
  // `scene.items` instead would still be O(clips) per frame for no reason, since
  // the answer only changes when the selection does.
  const parentIdsOfSelected = new Set();
  for (const id of selected) {
    const parentId = scene.byId.get(id)?.clip?.parentId;
    if (parentId) parentIdsOfSelected.add(parentId);
  }

  for (const item of cards) {
    drawClipCard(ctx, {
      item,
      theme,
      selected,
      parentIdsOfSelected,
      hover: state.hover,
      silenceCuts: state.silenceCuts,
      peaksFor: state.peaksFor,
      peaksPending: state.peaksPending,
      // The waveform pass culls its buckets to this visible x range, so a long
      // clip costs only what is actually on screen (see drawWaveform's
      // visible-bucket culling).
      view,
    });
  }
  for (const item of transitions) {
    drawTransitionCard(ctx, { item, selected, hover: state.hover });
  }

  if (state.recording?.trackId) drawRecordingPreview(ctx, { recording: state.recording, scene, theme, pps });
  if (state.lasso) drawLasso(ctx, { lasso: state.lasso, theme });

  ctx.restore();
  return { drawnClips: cards.length + transitions.length };
}

/** Lane rows + their divider lines + the locked-track hatching. */
function drawLaneBackground(ctx, { scene, theme, view }) {
  const left = view.scrollLeft;
  const width = view.width;
  for (const row of scene.rows) {
    if (row.track?.locked) {
      // `.track-lane-row.lane-locked` REPLACES the row background (it has the
      // higher-specificity selector), so the container colour shows through the
      // 0.6-alpha bands rather than sitting under an opaque fill.
      ctx.fillStyle = theme.darkest;
      ctx.fillRect(left, row.y, width, row.height);
      drawLockedHatch(ctx, { row, theme, left, width });
    } else {
      ctx.fillStyle = theme.laneBackground;
      ctx.fillRect(left, row.y, width, row.height);
    }

    ctx.fillStyle = theme.divider;
    ctx.fillRect(left, row.y + row.height - 1, width, 1);
  }

  // Below the last row (empty space past the tracks) is the scroll area's own
  // background (--unity-darkest), NOT the panel colour.
  const lastRow = scene.rows[scene.rows.length - 1];
  const bottom = lastRow ? lastRow.y + lastRow.height : 0;
  if (bottom < view.scrollTop + view.height) {
    ctx.fillStyle = theme.darkest;
    ctx.fillRect(left, bottom, width, view.scrollTop + view.height - bottom);
  }
}

/**
 * `.track-lane-row.lane-locked`'s repeating 45deg gradient: 10px bands of
 * theme.laneLockedA alternating with 10px bands of theme.laneLockedB, the
 * stripes running top-left to bottom-right (a 45deg CSS gradient measures its
 * stops along the gradient axis, which for 45deg is exactly the perpendicular
 * stripe width).
 *
 * The previous version drew 10px-wide strokes every 20px in the OPPOSITE
 * direction, which read as a different texture from the DOM's lane.
 */
function drawLockedHatch(ctx, { row, theme, left, width }) {
  const h = row.height;
  // Lines of the form x - y = c run along the 45deg direction; the distance
  // between two such lines is |Δc| / √2, so a 20px period means Δc = 20√2.
  const period = 20 * Math.SQRT2;
  const farthest = left + width + h;
  const first = Math.floor((left - h) / period) * period;

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, row.y, width, h);
  ctx.clip();
  ctx.lineWidth = 10;
  // Two passes, half a period apart: each pass fills every other band.
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? theme.laneLockedA : theme.laneLockedB;
    for (let c = first + (pass * period) / 2; c <= farthest; c += period) {
      ctx.beginPath();
      ctx.moveTo(c, row.y);
      ctx.lineTo(c + h, row.y + h);
      ctx.stroke();
    }
  }
  ctx.restore();
}


/**
 * Vertical grid, matching `.track-grid-pattern` exactly.
 *
 * The DOM draws ONE line per major tick — a `linear-gradient(90deg,
 * rgba(255,255,255,0.14) 1px, transparent 1px)` repeated every
 * `getTickIntervalSeconds(pps) * pps` px — and nothing else. This used to draw
 * five times as many lines (a minor grid at interval/5, in a different, fainter
 * colour) plus a second major pass, so the canvas looked like a denser grid
 * than the renderer it is supposed to be pixel-identical to. It also bailed out
 * of BOTH passes when the minor spacing fell under 4px, which silently removed
 * the major lines too.
 *
 * Positions are derived from the step index (not accumulated) because `t +=
 * interval` drifts by a fraction of a pixel per step, which over an hour walks
 * the lines off the ruler's own ticks; and a 1px fill is left on integer
 * coordinates, since adding 0.5 (the convention for STROKES) only blurs it.
 */
function drawGrid(ctx, { scene, theme, view, pps }) {
  const interval = getTickIntervalSeconds(pps);
  const startTime = scene.xToTime(view.scrollLeft);
  const endTime = scene.xToTime(view.scrollLeft + view.width);

  ctx.fillStyle = theme.gridLine;
  const firstIndex = Math.floor(startTime / interval);
  for (let i = firstIndex; i * interval <= endTime; i++) {
    const x = Math.round(i * interval * pps);
    ctx.fillRect(x, view.scrollTop, 1, view.height);
  }
}

/**
 * One clip card: background, category accent, title, duration, waveform and the
 * state borders, mirroring ClipItem.jsx + clip-item.css.
 */
function drawClipCard(ctx, {
  item,
  theme,
  selected,
  parentIdsOfSelected,
  hover,
  silenceCuts,
  peaksFor,
  peaksPending,
  view,
}) {
  // Selection lives here, not in the scene: see the note in timelineScene.js.
  const isSelected = selected.has(item.id);
  const isHovered = hover?.clipId === item.id;
  const style = theme.cards[item.category] || theme.cards.prefab;
  const x = item.x;
  const y = item.y;
  const w = item.width;
  const h = item.height;

  // Zoomed far enough out that a card is a couple of pixels wide: only the
  // background matters, and skipping the rounded clip + border + text for these
  // is what keeps a whole-hour view at thousands of clips cheap to draw.
  if (w < 3) {
    ctx.fillStyle = style.background;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = style.accent;
    ctx.fillRect(x, y, Math.min(1, w), h);
    return;
  }

  // `.timeline-clip-card.is-locked` is `opacity: 0.7` — a FADE of the whole
  // card, not a dark wash over it (which is what this used to draw, reading as
  // a grey slab rather than a dimmed clip).
  ctx.save();
  ctx.globalAlpha = item.isLocked ? 0.7 : 1;
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, 4);
  ctx.clip();

  ctx.fillStyle = style.background;
  ctx.fillRect(x, y, w, h);

  // Category accent stripe (the DOM card's 3px border-left).
  ctx.fillStyle = item.isMissingMedia ? MISSING_MEDIA_COLOR : style.accent;
  ctx.fillRect(x, y, 3, h);

  // Waveform: any clip that carries audio (the DOM keys this off hasAudio, not
  // off the card category, so a video clip with an AudioSource shows one too),
  // and only when the card is wide enough for it to read — below 30px the DOM
  // skips it as well.
  const waveformBox = waveformRectFor(item);
  if (waveformBox && wantsWaveform(item)) {
    const envelope = peaksFor ? peaksFor(item) : null;
    if (envelope) {
      drawWaveformEnvelope(ctx, {
        ...waveformBox,
        envelope,
        // The waveform colour is a theme setting (Settings -> Appearance);
        // with no DOM it falls back to the shipped violet ClipItem has always
        // passed for a clip that carries audio.
        color: `rgba(${theme.waveformRgb}, 0.55)`,
        view,
      });
    } else if (peaksPending ? peaksPending(item) : false) {
      // Per-clip, not global: a clip whose peaks came back empty must draw
      // nothing, not a hatch borrowed from some other clip's in-flight request.
      drawWaveformPlaceholder(ctx, { ...waveformBox, view });
    }
  }

  // Silence-cut overlay (SilenceRemoverPanel preview), drawn over the waveform.
  const cuts = silenceCuts?.get?.(item.id);
  if (cuts && cuts.length > 0 && item.clip.duration > 0) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
    for (const cut of cuts) {
      const cutX = x + (Math.max(0, cut.start) / item.clip.duration) * w;
      const cutW = Math.max(1, (Math.max(0, cut.duration) / item.clip.duration) * w);
      ctx.fillRect(cutX, y, Math.min(cutW, x + w - cutX), h);
    }
  }

  // Text: the title top-left and the duration bottom-right, exactly as the DOM
  // card lays them out (`.clip-content-box` padding 4px 6px, `justify-content:
  // space-between`, title 10px/600 white after a 12px type icon, duration 8px
  // dim at the bottom-right). This used to draw a single
  // "name (12.0s)" line that exists nowhere in the DOM — that concatenation is
  // the card's TOOLTIP, not its label.
  drawCardText(ctx, { item, theme, category: item.category, x, y, w, h });

  ctx.restore();

  // ── State borders, in the DOM's own precedence ──────────────────────────
  // `.selected` (2px, !important, declared last) wins; then the linked-child /
  // linked-parent dashes; then `.missing-media`; then hover; then the plain edge.
  const border = cardBorderFor({ item, isSelected, isHovered, parentIdsOfSelected, theme });
  ctx.save();
  ctx.globalAlpha = item.isLocked ? 0.7 : 1;
  ctx.lineWidth = border.width;
  ctx.strokeStyle = border.color;
  // `.is-locked { border-style: dashed }`, but a SELECTED card's `border: 2px
  // solid` shorthand is declared after it and resets the style, so locked only
  // reads as dashed while it is not the selection.
  if (item.isLocked && !isSelected) ctx.setLineDash([4, 3]);
  ctx.beginPath();
  roundRect(ctx, x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1), 4);
  ctx.stroke();
  ctx.setLineDash([]);

  // `.timeline-clip-card.is-child` — a dashed TOP edge on any clip with a
  // parent, drawn on top of whatever border the state above chose (the DOM's
  // border-top is a separate longhand, so the two coexist).
  if (item.clip.parentId) {
    ctx.strokeStyle = accentWithAlpha(theme, 0.35);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x + 1, y + 0.5);
    ctx.lineTo(x + w - 1, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // Locked badge and missing-media warning, same corner language as the DOM.
  ctx.save();
  ctx.globalAlpha = item.isLocked ? 0.7 : 1;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (item.isLocked) {
    ctx.fillStyle = LOCK_GLYPH_COLOR;
    ctx.fillText('🔒', x + w - 14, y + 9);
  } else if (item.isMissingMedia) {
    ctx.fillStyle = MISSING_MEDIA_COLOR;
    ctx.fillText('⚠', x + w - 14, y + 9);
  }
  ctx.restore();
}

/** The card's border colour/width/dash, in the DOM stylesheet's precedence. */
function cardBorderFor({ item, isSelected, isHovered, parentIdsOfSelected, theme }) {
  if (isSelected) return { color: theme.accentBright, width: 2 };
  const isChildOfSelected = Boolean(item.clip.parentId && parentIdsOfSelected.has(item.clip.parentId));
  if (isChildOfSelected) return { color: theme.accentBright, width: 1 };
  if (parentIdsOfSelected.has(item.id)) return { color: LINKED_PARENT_COLOR, width: 1 };
  if (item.isMissingMedia) return { color: MISSING_MEDIA_COLOR, width: 1 };
  if (isHovered) return { color: accentWithAlpha(theme, 0.55), width: 1 };
  return { color: DEFAULT_CARD_BORDER, width: 1 };
}

/**
 * Title + duration, clipped to the card (the caller's clip), so a name wider
 * than the card is cut off instead of overhanging — matching
 * `.clip-title-text`'s overflow:hidden / text-overflow:ellipsis.
 */
function drawCardText(ctx, { item, theme, category, x, y, w, h }) {
  if (w <= 24 || h < 12) return;
  const title = String(item.clip.name ?? '');
  const duration = Number.isFinite(item.clip.duration) ? item.clip.duration : 0;

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  // 4px top padding + half the 12px icon row.
  ctx.fillStyle = CARD_TITLE_COLOR;
  ctx.font = '600 10px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.fillText(CATEGORY_GLYPH[category] || CATEGORY_GLYPH.prefab, x + 6, y + 10);
  ctx.fillText(title, x + 22, y + 10);

  // Only worth a second row when there is actually a second row of height.
  if (h >= 26 && w > 30) {
    ctx.fillStyle = theme.textDim;
    ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${duration.toFixed(1)}s`, x + w - 6, y + h - 8);
    ctx.textAlign = 'left';
  }
}

/**
 * Transition clip — the DOM's TransitionClipItem.jsx, feature for feature.
 *
 * A full-height card on top of its two neighbours (z-index 12, above the clip
 * cards' 10), with the DOM's 135deg amber hatch, the dashed cut marker down the
 * middle (a transition is SYMMETRIC about the cut — that line is the whole
 * point of the block), the black-framed preset label pill between the two edge
 * handles, and the red-dashed orphan state when a neighbour was moved or
 * trimmed away and export would refuse to blend it.
 *
 * Border precedence follows the stylesheet's own order, which is not the
 * "selected always wins" order you might expect: `.selected`, `.is-locked` and
 * `.is-orphan` all have the same specificity, so the LAST one declared wins —
 * orphan is last, so an orphaned transition stays red-dashed even while
 * selected (it is telling you it will not render, which outranks selection).
 */
function drawTransitionCard(ctx, { item, selected, hover }) {
  const isSelected = selected.has(item.id);
  const isOrphan = Boolean(item.isOrphanTransition);
  const isHovered = hover?.clipId === item.id;
  const x = item.x;
  const y = item.y;
  const w = Math.max(6, item.width);
  const h = item.height;

  ctx.save();
  ctx.globalAlpha = item.isLocked ? 0.7 : 1;
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, 4);
  ctx.clip();

  // Base wash, then the hatch: 5px of amber (or red when orphaned) / 5px of the
  // faint variant, at 135deg. A 135deg CSS gradient runs down-right, so its
  // stripes run up-right ("/"); a 45deg one (the locked LANE hatch above) is the
  // other diagonal. The band width is measured along the gradient axis, which
  // for a diagonal gradient equals the perpendicular stripe width.
  ctx.fillStyle = isOrphan ? 'rgba(20, 8, 8, 0.6)' : 'rgba(20, 16, 8, 0.55)';
  ctx.fillRect(x, y, w, h);
  const maxSeg = isOrphan ? 'rgba(239, 68, 68, 0.32)' : 'rgba(245, 158, 11, 0.42)';
  const minSeg = isOrphan ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.16)';
  // Lines of constant x + y intersect the card for c in [x + y, x + w + y + h].
  const maxC = x + w + y + h;
  const period = 10 * Math.SQRT2; // 10px perpendicular band width => 20px period
  ctx.lineWidth = 5;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? maxSeg : minSeg;
    for (let c = x + y + (pass * period) / 2; c <= maxC; c += period) {
      const startY = Math.max(y, c - (x + w));
      const endY = Math.min(y + h, c - x);
      if (endY <= startY) continue;
      ctx.beginPath();
      ctx.moveTo(c - startY, startY);
      ctx.lineTo(c - endY, endY);
      ctx.stroke();
    }
  }

  // The cut itself: 1px dashed white at 50%, full card height.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  const cutX = x + w / 2;
  ctx.moveTo(cutX, y);
  ctx.lineTo(cutX, y + h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Border (see the precedence note above), then the two edge grab zones.
  const borderColor = isOrphan
    ? TRANSITION_ORPHAN_COLOR
    : isSelected
      ? TRANSITION_SELECTED_COLOR
      : isHovered
        ? TRANSITION_SELECTED_COLOR
        : TRANSITION_COLOR;
  const borderWidth = !isOrphan && isSelected ? 2 : 1;
  ctx.save();
  ctx.globalAlpha = item.isLocked ? 0.7 : 1;
  ctx.lineWidth = borderWidth;
  ctx.strokeStyle = borderColor;
  if (isOrphan || item.isLocked) ctx.setLineDash([4, 3]);
  ctx.beginPath();
  roundRect(ctx, x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1), 4);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // `.transition-edge-handle`: 7px of rgba(0,0,0,0.35) inside each edge.
  const edge = Math.min(TRIM_HANDLE_WIDTH_PX, w / 2);
  ctx.save();
  ctx.globalAlpha = item.isLocked ? 0.7 : 1;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(x, y, edge, h);
  ctx.fillRect(x + w - edge, y, edge, h);
  ctx.restore();

  // Preset label pill — the DOM only shows it once the card is wider than 46px
  // (below that there is no room for the pill between the handles).
  if (w > 46 && h >= 12) {
    drawTransitionLabel(ctx, { item, isOrphan, x, y, w, h });
  }
}

/** The `#fde68a`/rgba(0,0,0,0.6) preset pill centred on the card. */
function drawTransitionLabel(ctx, { item, isOrphan, x, y, w, h }) {
  const label = String(item.transitionLabel || item.transitionPreset || 'transition');
  const text = isOrphan ? `⚠ ${label}` : label;

  ctx.save();
  ctx.font = '600 10px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textWidth = typeof ctx.measureText === 'function' ? ctx.measureText(text).width : text.length * 6;
  const pillW = Math.min(w - 4, textWidth + 10);
  const pillH = 14;
  const pillX = x + w / 2 - pillW / 2;
  const pillY = y + h / 2 - pillH / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath();
  roundRect(ctx, pillX, pillY, pillW, pillH, 3);
  ctx.fill();
  ctx.fillStyle = isOrphan ? '#f87171' : '#fde68a';
  ctx.fillText(text, x + w / 2, y + h / 2);
  ctx.restore();
}

/**
 * Live recording preview — the DOM's LiveRecordingClipPreview.jsx.
 *
 * Geometry must match it exactly: `left: startTime * pps`, `top: 2px` into the
 * row, `height: max(20, rowHeight - 4)`, and a width that GROWS with the
 * elapsed recording time (`max(16, (now - startTime) * pps)`), which is what
 * makes the bar crawl rightwards while recording. `now` therefore has to be the
 * live playhead time, not a constant: TimelineCanvas passes it from
 * playbackStore at draw time (see the frame-callback subscription there).
 */
function drawRecordingPreview(ctx, { recording, scene, theme, pps }) {
  const row = scene.rows.find((r) => r.trackId === recording.trackId);
  if (!row) return;
  const elapsed = Math.max(0, (recording.currentTime ?? recording.startTime) - recording.startTime);
  const x = recording.startTime * pps;
  const w = Math.max(16, elapsed * pps);
  const y = row.y + 2;
  const h = Math.max(20, row.height - 4);
  const level = Math.max(0, Math.min(1, recording.level || 0));

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = RECORDING_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));

  // Header row: pulse dot + elapsed time (LiveRecordingClipPreview's
  // "REC 00:00.0"), then the level meter as a horizontal bar. Drawn in the same
  // order/positions as the DOM so the two read identically.
  ctx.fillStyle = RECORDING_COLOR;
  ctx.beginPath();
  ctx.arc(x + 8, y + 11, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = theme.text;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(`REC ${formatElapsed(elapsed)}`, x + 16, y + 11);

  const meterY = y + h - 14;
  const meterW = Math.max(0, w - 12);
  if (meterW > 4) {
    const pct = Math.min(1, Math.max(0.04, level));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x + 6, meterY, meterW, 8);
    ctx.fillStyle = pct > 0.8 ? '#ef4444' : pct > 0.5 ? '#f59e0b' : '#10b981';
    ctx.fillRect(x + 6, meterY, meterW * pct, 8);
  }
  ctx.restore();
}

/** mm:ss.t, matching LiveRecordingClipPreview's formatElapsed. */
function formatElapsed(seconds) {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

/** Export-range dimming + in/out markers (the DOM overlays in Timeline.jsx). */
function drawExportRange(ctx, { exportRange, view, pps }) {
  const inX = Math.max(0, (exportRange.in || 0) * pps);
  const outX = (exportRange.out ?? exportRange.in ?? 0) * pps;
  const left = view.scrollLeft;
  const right = view.scrollLeft + view.width;
  const top = view.scrollTop;
  const bottom = view.scrollTop + view.height;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  if (inX > left) ctx.fillRect(left, top, Math.min(inX, right) - left, bottom - top);
  if (outX < right) ctx.fillRect(Math.max(outX, left), top, right - Math.max(outX, left), bottom - top);

  // Marker colours and widths match the DOM (.export-range-marker.in-marker is
  // green with a lighter left edge, .out-marker red with a lighter right edge),
  // so the in/out points read the same in both renderers.
  // `.in-marker` is `#22c55e` with a 2px `#86efac` LEFT border, and
  // `.out-marker` is `#ef4444` with a 2px `#fca5a5` RIGHT border — so the light
  // edge is 2 of the 3 pixels, and on the outer side of the marker in each case.
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(inX + 2, top, 1, bottom - top);
  ctx.fillStyle = '#86efac';
  ctx.fillRect(inX, top, 2, bottom - top);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(outX - 3, top, 1, bottom - top);
  ctx.fillStyle = '#fca5a5';
  ctx.fillRect(outX - 1, top, 2, bottom - top);
  ctx.restore();
}

/** Lasso rectangle (the DOM `.timeline-box-select` overlay). */
function drawLasso(ctx, { lasso, theme }) {
  const x = Math.min(lasso.x0, lasso.x1);
  const y = Math.min(lasso.y0, lasso.y1);
  const w = Math.abs(lasso.x1 - lasso.x0);
  const h = Math.abs(lasso.y1 - lasso.y0);
  ctx.save();
  ctx.fillStyle = accentWithAlpha(theme, 0.12);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = theme.accentBright;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  ctx.restore();
}

/**
 * Where a clip's waveform sits inside its card.
 *
 * ClipItem centres a `(widthPx - 8) x (cardHeight - 6)` WaveformCanvas in the
 * card, i.e. exactly a 4px horizontal / 3px vertical inset — and the SIZE has
 * to match, not just the position, because WaveformCanvas derives its peak
 * bucket count from its own height and width (see drawWaveform.bucketsForCard):
 * a different box would ask the peak cache for a second, redundant set of
 * buckets for the same clip.
 */
export function waveformRectFor(item) {
  if (item.kind === 'transition') return null;
  const insetX = 4;
  const insetY = 3;
  const w = item.width - insetX * 2;
  const h = item.height - insetY * 2;
  if (w <= 0 || h <= 0) return null;
  return { x: item.x + insetX, y: item.y + insetY, width: w, height: h };
}

/**
 * True when this item shows a waveform.
 *
 * ClipItem's `showWaveform = hasAudio && audioUrl && widthPx > 30` — keyed on
 * the clip CARRYING AUDIO, not on its card category, so a video clip with an
 * AudioSource component shows a waveform too (this used to test `category ===
 * 'audio'` and silently dropped those). The 30px floor is the same one the DOM
 * uses: below it the shape is unreadable.
 */
export function wantsWaveform(item) {
  return item.kind !== 'transition' && item.hasAudio === true && Boolean(item.audioUrl) && item.width > 30;
}

/** Cursor for a hover zone — re-exported so the component needs one import. */
export { cursorForZone };

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
