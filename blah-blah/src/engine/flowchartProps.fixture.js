/**
 * The Flowchart canvas script's `static props`, in both spellings.
 *
 * This is the parity fixture for the prop helpers (engine/scriptProps.js):
 * FLOWCHART_PROPS_ORIGINAL is the hand-written declaration that shipped, and
 * FLOWCHART_PROPS_REWRITTEN declares the same fields with the helpers. The test
 * asserts `extractScriptProps` produces IDENTICAL field arrays for the two, so
 * the rewrite is provably a pure refactor — same tabs, same boxes, same inline
 * rows, same order, same defaults, same labels.
 *
 * Only the props block is reproduced here (the script's methods are untouched
 * by this change, so there is nothing to prove about them). The rewritten form
 * is what a script should now look like; the original is kept as the baseline
 * this refactor must not shift.
 *
 * Strings are declared with String.raw so the `\n` inside the Flow default
 * survives as two characters (an escape the props evaluator then interprets),
 * exactly as it does in the real script file.
 */

/** The declaration as it was written by hand. */
export const FLOWCHART_PROPS_ORIGINAL = String.raw`
export default class Flowchart {
  static props = {
    // ─── TAB: Flow ────────────────────────────────────────────────────────
    flow: {
      type: 'textarea',
      label: 'Flow',
      tab: 'Flow',
      default:
        'Start(pill) -> Load Data -> Valid?\n' +
        'Valid? -> Process : yes\n' +
        'Valid? -> Error(round) : no\n' +
        'Process -> Done(pill)\n' +
        'Error -> Done',
    },
    direction: {
      type: 'select',
      default: 'horizontal',
      options: ['horizontal', 'vertical'],
      label: 'Direction',
      tab: 'Flow',
    },
    overrides: {
      type: 'textarea',
      label: 'Position Overrides',
      tab: 'Flow',
      box: 'Manual Positioning',
      default: '',
    },

    // ─── TAB: Timing ──────────────────────────────────────────────────────
    fitToDuration: { type: 'boolean', default: false, label: 'Fit Steps To Clip Duration', tab: 'Timing' },
    startDelay:   { type: 'number', default: 0.3, min: 0, max: 30, step: 0.05, label: 'Start Delay (s)', tab: 'Timing', inline: true },
    stepDelay:    { type: 'number', default: 0.45, min: 0.02, max: 10, step: 0.05, label: 'Step Delay (s)', tab: 'Timing', inline: true },
    animDuration: { type: 'number', default: 0.45, min: 0.05, max: 5, step: 0.05, label: 'Anim Duration (s)', tab: 'Timing' },
    ease: {
      type: 'select', default: 'outBack', label: 'Ease',
      options: ['linear', 'outCubic', 'outBack', 'outElastic', 'outBounce', 'inOutCubic'],
      tab: 'Timing',
    },
    endHold:       { type: 'number', default: 0.5, min: 0, max: 30, step: 0.1, label: 'End Hold (s)', tab: 'Timing', inline: true },
    exitAt:        { type: 'number', default: 0, min: 0, max: 600, step: 0.1, label: 'Fade Out At (s)', tab: 'Timing', inline: true },
    autoFadeOut:   { type: 'boolean', default: false, label: 'Auto Fade Out At End', tab: 'Timing' },

    // ─── TAB: Audio FX ────────────────────────────────────────────────────
    nodeSfx: {
      type: 'asset',
      assetType: 'audio',
      label: 'Node Appear SFX',
      tab: 'Audio FX',
      box: 'Sound Effects',
    },
    edgeSfx: {
      type: 'asset',
      assetType: 'audio',
      label: 'Edge Connect SFX',
      tab: 'Audio FX',
      box: 'Sound Effects',
    },
    sfxVolume: {
      type: 'number',
      default: 0.7,
      min: 0,
      max: 1,
      step: 0.05,
      label: 'SFX Volume',
      tab: 'Audio FX',
      box: 'Sound Effects',
    },
    previewSfx: {
      type: 'button',
      label: 'Test Play SFX',
      action: 'testSfx',
      tab: 'Audio FX',
      box: 'Sound Effects',
    },

    // ─── TAB: Style ───────────────────────────────────────────────────────
    // Node dimensions
    nodeWidth:  { type: 'number', default: 200, min: 60, max: 600, step: 1, label: 'Node Width', tab: 'Style', box: 'Dimensions', inline: true },
    nodeHeight: { type: 'number', default: 80, min: 30, max: 300, step: 1, label: 'Node Height', tab: 'Style', box: 'Dimensions', inline: true },
    gapX:       { type: 'number', default: 90, min: 10, max: 600, step: 1, label: 'Flow Gap', tab: 'Style', box: 'Dimensions', inline: true },
    gapY:       { type: 'number', default: 50, min: 10, max: 600, step: 1, label: 'Cross Gap', tab: 'Style', box: 'Dimensions', inline: true },
    cornerRadius:{ type: 'number', default: 14, min: 0, max: 60, step: 1, label: 'Corner Radius', tab: 'Style', box: 'Dimensions' },
    curved:      { type: 'boolean', default: true, label: 'Curved Edges', tab: 'Style', box: 'Dimensions' },

    // View & placement
    autoFit:   { type: 'boolean', default: true, label: 'Auto Fit To Frame', tab: 'Style', box: 'Transform' },
    padding:   { type: 'number', default: 80, min: 0, max: 500, step: 1, label: 'Fit Padding', tab: 'Style', box: 'Transform' },
    scale:     { type: 'number', default: 1, min: 0.1, max: 5, step: 0.05, label: 'Scale', tab: 'Style', box: 'Transform', inline: true },
    chartSize: { type: 'number', default: 1, min: 0.1, max: 5, step: 0.05, label: 'Chart Size', tab: 'Style', box: 'Transform', inline: true },
    offsetX:   { type: 'number', default: 0, min: -3000, max: 3000, step: 1, label: 'Offset X', tab: 'Style', box: 'Transform', inline: true },
    offsetY:   { type: 'number', default: 0, min: -3000, max: 3000, step: 1, label: 'Offset Y', tab: 'Style', box: 'Transform', inline: true },

    // Colors
    nodeFill:    { type: 'color', default: '#1e293b', label: 'Node Fill', tab: 'Style', box: 'Colors', inline: true },
    nodeStroke:  { type: 'color', default: '#38bdf8', label: 'Node Stroke', tab: 'Style', box: 'Colors', inline: true },
    textColor:   { type: 'color', default: '#f8fafc', label: 'Text Color', tab: 'Style', box: 'Colors', inline: true },
    edgeColor:   { type: 'color', default: '#94a3b8', label: 'Edge Color', tab: 'Style', box: 'Colors', inline: true },
    strokeWidth: { type: 'number', default: 3, min: 1, max: 16, step: 0.5, label: 'Stroke Width', tab: 'Style', box: 'Colors', inline: true },
    arrowSize:   { type: 'number', default: 14, min: 4, max: 80, step: 1, label: 'Arrow Size', tab: 'Style', box: 'Colors', inline: true },

    // Typography
    fontFamily:  { type: 'font', default: 'Inter', label: 'Font', tab: 'Style', box: 'Typography' },
    fontSize:    { type: 'number', default: 26, min: 8, max: 120, step: 1, label: 'Font Size', tab: 'Style', box: 'Typography', inline: true },
    fontWeight:  { type: 'number', default: 600, min: 100, max: 900, step: 100, label: 'Font Weight', tab: 'Style', box: 'Typography', inline: true },

    debug:       { type: 'boolean', default: false, label: 'Show Debug Text', tab: 'Style' },
  };

  onMount() {}
}
`;

/**
 * The same declaration, rewritten with the helpers.
 *
 * `group('Flow', …)` supplies the tab for the three Flow fields;
 * `Presets.timing` / `Presets.audioFx` carry their own tab and box;
 * `group('Style', { box: 'Dimensions' }, …)` does the six node-dimension
 * fields; the three presets cover Transform / Colors / Typography, so the
 * Style tab reads in the same box order as before (Dimensions, Transform,
 * Colors, Typography, then the plain `debug` row).
 *
 * Labels are gone from every field whose key humanises correctly — the
 * `(s)` suffixes come from `unit`, and only the handful that do not read well
 * (`gapX` -> 'Flow Gap', `fontFamily` -> 'Font', `autoFit` -> 'Auto Fit To
 * Frame', …) still spell theirs out.
 */
export const FLOWCHART_PROPS_REWRITTEN = String.raw`
export default class Flowchart {
  static props = {
    ...group('Flow', {
      flow: text(
        'Start(pill) -> Load Data -> Valid?\n' +
        'Valid? -> Process : yes\n' +
        'Valid? -> Error(round) : no\n' +
        'Process -> Done(pill)\n' +
        'Error -> Done',
        { multiline: true },
      ),
      direction: select('horizontal', ['horizontal', 'vertical']),
      // A textarea, not a string: the original declares type: 'textarea'.
      overrides: text('', { multiline: true, label: 'Position Overrides', box: 'Manual Positioning' }),
    }),

    ...Presets.timing,
    ...Presets.audioFx,

    ...group('Style', { box: 'Dimensions' }, {
      nodeWidth: num(200, { min: 60, max: 600, step: 1, inline: true }),
      nodeHeight: num(80, { min: 30, max: 300, step: 1, inline: true }),
      gapX: num(90, { min: 10, max: 600, step: 1, label: 'Flow Gap', inline: true }),
      gapY: num(50, { min: 10, max: 600, step: 1, label: 'Cross Gap', inline: true }),
      cornerRadius: num(14, { min: 0, max: 60, step: 1 }),
      curved: bool(true, { label: 'Curved Edges' }),
    }),
    ...Presets.fitTransform,
    ...Presets.colors,
    ...Presets.typography,

    debug: bool(false, { label: 'Show Debug Text', tab: 'Style' }),
  };

  onMount() {}
}
`;
