/**
 * Short prop-declaration helpers for script `static props`.
 *
 * A script's Inspector fields are declared in a plain object
 * (`static props = { … }`) which engine/inspectorAttributes.js normalises and
 * engine/referenceTypes.js resolves. Written by hand, every field repeats the
 * same layout keys (`tab`, `box`, `inline`, `label`), and whole blocks — the
 * timing fields, the audio-FX fields, a colour palette — get copy-pasted
 * between scripts and drift apart.
 *
 * These helpers collapse that. They are NOT a new schema and NOT a new engine:
 * every one of them returns the exact plain object `static props` always
 * accepted, so the Inspector, keyframes, autosave and export are untouched.
 * That also means the two forms mix freely in one object:
 *
 *   static props = {
 *     speed: num(2.5, { min: 0, max: 10, step: 0.1 }),   // helper
 *     tint:  { type: 'color', default: '#ff0000' },       // plain literal
 *   };
 *
 * ─── Where the helpers come from ────────────────────────────────────────────
 *
 * They are injected as globals in BOTH execution paths (scriptRunner.js), so
 * no import line is needed:
 *   - the props evaluator, which reads `static props` straight out of the
 *     source text to build the Inspector schema, and
 *   - the module wrapper, so a script that CALLS a helper while defining its
 *     class compiles.
 * `import { num, Presets } from 'blahblah'` also resolves, backed by this same
 * module (scriptBundler.js serves it as a virtual module), for scripts that
 * prefer an explicit import.
 *
 * ─── Labels ─────────────────────────────────────────────────────────────────
 *
 * A helper cannot know which key it is being assigned to, so it marks its
 * result (AUTO_LABEL_KEY) instead of inventing a label. `derivePropLabel()`
 * then fills in `label: 'Start Delay'` from the key `startDelay` when the
 * object is read. An explicit `opts.label` always wins, which is why
 * `gapX` (Flow Gap) and `fontSize`-like keys that do not read well
 * humanised still spell their label out.
 *
 * ONLY marked fields are relabelled, so an old-style literal that omits
 * `label` keeps getting its raw key exactly as before.
 *
 * THIS FILE MUST STAY DEPENDENCY-FREE: scriptBundler.js serves its raw text
 * as the `blahblah` virtual module (same `?raw` trick as the SDK), so it
 * cannot import anything without breaking that.
 */

/**
 * Marks a definition as helper-produced. Two jobs:
 *   - `derivePropLabel` only relabels marked fields, so old-style literals
 *     keep their exact previous behaviour;
 *   - `parseFieldAttributes` / `extractScriptProps` cherry-pick the keys they
 *     know, so the marker never reaches the Inspector.
 */
export const AUTO_LABEL_KEY = '__autoLabel';

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `startDelay` -> `'Start Delay'`, `offsetX` -> `'Offset X'`, `sfxVolume` ->
 * `'Sfx Volume'`. Splits camelCase and separators, then capitalises each word
 * while leaving the rest of it alone (so `sfx` stays `Sfx`, not `SFX` — an
 * acronym table would be guessing).
 */
export function humanizePropName(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** The type `extractScriptProps` infers for a bare shorthand value. */
export function inferPropType(value) {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return 'color';
  return 'string';
}

/**
 * Turn a definition into a helper-produced one: keep its keys, add the marker,
 * and let `opts` carry layout attributes. `type` and `default` in `opts` are
 * ignored — they are the helper's own arguments, and letting `opts` overwrite
 * them would make `num(1, { type: 'select' })` silently stop being a number.
 */
function marked(def, opts) {
  const out = { ...def };
  if (isPlainObject(opts)) {
    for (const [key, value] of Object.entries(opts)) {
      if (key === 'type' || key === 'default' || key === AUTO_LABEL_KEY) continue;
      if (value !== undefined) out[key] = value;
    }
  }
  out[AUTO_LABEL_KEY] = true;
  return out;
}

/**
 * Read a helper-produced definition's label, or the definition unchanged.
 *
 * Called by `extractScriptProps` for every entry before it builds the field,
 * which is the only place the KEY is known. Marked fields get
 * `label: 'Start Delay'` (plus ` (s)` when `opts.unit` was given); unmarked
 * fields are returned untouched so old-style declarations are byte-identical.
 */
export function derivePropLabel(name, def) {
  if (!isPlainObject(def) || def[AUTO_LABEL_KEY] !== true) return def;
  const { [AUTO_LABEL_KEY]: _marker, unit, ...rest } = def;
  const explicit = typeof rest.label === 'string' && rest.label.trim() ? rest.label.trim() : null;
  const suffix = typeof unit === 'string' && unit ? ` (${unit})` : '';
  return { ...rest, label: explicit || `${humanizePropName(name)}${suffix}` };
}

/** Normalise a shorthand value into a definition `group` / `row` can annotate. */
function asDefinition(value) {
  if (isPlainObject(value)) return { ...value };
  return { type: inferPropType(value), default: value, [AUTO_LABEL_KEY]: true };
}

// ─── Basic helpers ──────────────────────────────────────────────────────────

/** A number field: `num(0.3, { min: 0, max: 30, step: 0.05, unit: 's' })`. */
export function num(value, opts) {
  return marked({ type: 'number', default: value }, opts);
}

/** A checkbox: `bool(true)`. */
export function bool(value, opts) {
  return marked({ type: 'boolean', default: value }, opts);
}

/** A colour picker: `color('#ff0000')`. */
export function color(value, opts) {
  return marked({ type: 'color', default: value }, opts);
}

/** A string field; `{ multiline: true }` makes it a textarea. */
export function text(value, opts) {
  const multiline = Boolean(opts && opts.multiline);
  const rest = isPlainObject(opts) ? { ...opts, multiline: undefined } : undefined;
  return marked({ type: multiline ? 'textarea' : 'string', default: value }, rest);
}

/** A dropdown: `select('horizontal', ['horizontal', 'vertical'])`. */
export function select(value, options, opts) {
  return marked({ type: 'select', default: value, options }, opts);
}

/**
 * A media slot: `asset('audio')`. Picks nothing by default (the slot starts
 * empty and resolves to an AssetRef at runtime), so — like the plain form —
 * it carries no `default` key at all.
 */
export function asset(assetType, opts) {
  if (isPlainObject(assetType)) return marked({ type: 'asset' }, assetType);
  return marked(assetType ? { type: 'asset', assetType } : { type: 'asset' }, opts);
}

/**
 * An entity slot: `entity({ targetComponent: 'AudioSource' })`. Picks nothing
 * by default and resolves to an EntityRef at runtime, so it is the exact
 * counterpart of `asset()` above — extractScriptProps treats the two as the
 * same reference kind.
 */
export function entity(opts) {
  return marked({ type: 'entity' }, opts);
}

/** The searchable font-family picker: `font('Inter')`. */
export function font(value, opts) {
  return marked({ type: 'font', default: value }, opts);
}

/**
 * An action button: `button('testSfx', { label: 'Test Play SFX' })`. Holds no
 * value; the script implements a method with that name.
 */
export function button(action, opts) {
  return marked(action ? { type: 'button', action } : { type: 'button' }, opts);
}

// ─── Grouping ───────────────────────────────────────────────────────────────

/**
 * Apply one `tab` (and optionally a `box`) to a whole block, so a group of
 * fields does not repeat the layout keys:
 *
 *   ...group('Timing', { box: 'Delays' }, { delay: num(0.3), hold: num(0.5) })
 *   ...group('Style', Presets.colors)
 *
 * `tab` is applied to every field inside, overriding one already there — that
 * is what makes `group` composable with the presets. Fields keep their own
 * order, which is what drives Inspector order.
 */
export function group(tab, opts, props) {
  const attributes = props === undefined ? null : opts;
  const source = props === undefined ? opts : props;
  const out = {};
  for (const [key, value] of Object.entries(source || {})) {
    const def = asDefinition(value);
    if (tab) def.tab = tab;
    if (attributes && attributes.box) def.box = attributes.box;
    if (attributes && attributes.inline) def.inline = true;
    out[key] = def;
  }
  return out;
}

/**
 * Mark a block's fields `inline: true` so they share one Inspector row:
 *
 *   ...row({ scale: num(1), chartSize: num(1) })
 */
export function row(props) {
  return group(null, { inline: true }, props);
}

// ─── Presets ────────────────────────────────────────────────────────────────

/**
 * The reusable blocks, lifted field-for-field from the Flowchart canvas script
 * that every other script was copying from. Each definition (default, bounds,
 * step, tab, box, inline, and any label the key does not humanise to) is
 * identical to the hand-written original, so spreading a preset reproduces
 * that script's Inspector exactly — tabs, boxes, row grouping, order and
 * every default value.
 *
 * A later key in the same object overrides a preset field, the way spreading
 * always works:
 *
 *   static props = { ...Presets.timing, startDelay: num(1.5, { unit: 's' }) };
 *
 * (The override keeps `startDelay`'s position in the tab — JS object spread
 * re-uses an existing key's slot — so overriding never reshuffles the UI.)
 */
export const Presets = Object.freeze({
  /** Timing tab: when each diagram step appears, and how it fades out. */
  timing: Object.freeze({
    fitToDuration: bool(false, { label: 'Fit Steps To Clip Duration', tab: 'Timing' }),
    startDelay: num(0.3, { min: 0, max: 30, step: 0.05, unit: 's', tab: 'Timing', inline: true }),
    stepDelay: num(0.45, { min: 0.02, max: 10, step: 0.05, unit: 's', tab: 'Timing', inline: true }),
    animDuration: num(0.45, { min: 0.05, max: 5, step: 0.05, unit: 's', tab: 'Timing' }),
    ease: select('outBack', ['linear', 'outCubic', 'outBack', 'outElastic', 'outBounce', 'inOutCubic'], {
      tab: 'Timing',
    }),
    endHold: num(0.5, { min: 0, max: 30, step: 0.1, unit: 's', tab: 'Timing', inline: true }),
    exitAt: num(0, { min: 0, max: 600, step: 0.1, label: 'Fade Out At (s)', tab: 'Timing', inline: true }),
    autoFadeOut: bool(false, { label: 'Auto Fade Out At End', tab: 'Timing' }),
  }),

  /** Audio FX tab: the sounds fired as steps are revealed. */
  audioFx: Object.freeze({
    nodeSfx: asset('audio', { label: 'Node Appear SFX', tab: 'Audio FX', box: 'Sound Effects' }),
    edgeSfx: asset('audio', { label: 'Edge Connect SFX', tab: 'Audio FX', box: 'Sound Effects' }),
    sfxVolume: num(0.7, { min: 0, max: 1, step: 0.05, label: 'SFX Volume', tab: 'Audio FX', box: 'Sound Effects' }),
    previewSfx: button('testSfx', {
      label: 'Test Play SFX',
      tab: 'Audio FX',
      box: 'Sound Effects',
    }),
  }),

  /** The Style tab's Typography box. */
  typography: Object.freeze({
    fontFamily: font('Inter', { label: 'Font', tab: 'Style', box: 'Typography' }),
    fontSize: num(26, { min: 8, max: 120, step: 1, tab: 'Style', box: 'Typography', inline: true }),
    fontWeight: num(600, { min: 100, max: 900, step: 100, tab: 'Style', box: 'Typography', inline: true }),
  }),

  /** The Style tab's Colors box. Every one of these keys humanises correctly. */
  colors: Object.freeze({
    nodeFill: color('#1e293b', { tab: 'Style', box: 'Colors', inline: true }),
    nodeStroke: color('#38bdf8', { tab: 'Style', box: 'Colors', inline: true }),
    textColor: color('#f8fafc', { tab: 'Style', box: 'Colors', inline: true }),
    edgeColor: color('#94a3b8', { tab: 'Style', box: 'Colors', inline: true }),
    strokeWidth: num(3, { min: 1, max: 16, step: 0.5, tab: 'Style', box: 'Colors', inline: true }),
    arrowSize: num(14, { min: 4, max: 80, step: 1, tab: 'Style', box: 'Colors', inline: true }),
  }),

  /** The Style tab's Transform box: how the finished diagram is placed. */
  fitTransform: Object.freeze({
    autoFit: bool(true, { label: 'Auto Fit To Frame', tab: 'Style', box: 'Transform' }),
    padding: num(80, { min: 0, max: 500, step: 1, label: 'Fit Padding', tab: 'Style', box: 'Transform' }),
    scale: num(1, { min: 0.1, max: 5, step: 0.05, tab: 'Style', box: 'Transform', inline: true }),
    chartSize: num(1, { min: 0.1, max: 5, step: 0.05, tab: 'Style', box: 'Transform', inline: true }),
    offsetX: num(0, { min: -3000, max: 3000, step: 1, tab: 'Style', box: 'Transform', inline: true }),
    offsetY: num(0, { min: -3000, max: 3000, step: 1, tab: 'Style', box: 'Transform', inline: true }),
  }),
});

// ─── Injection scope ────────────────────────────────────────────────────────

/**
 * Everything a script may use without importing it, in injection order.
 * scriptRunner.js spreads these names as parameters of its `new Function(…)`
 * wrappers and passes the matching values, which is what makes them globals in
 * both execution paths.
 */
export const PROP_HELPER_NAMES = Object.freeze([
  'num',
  'bool',
  'color',
  'text',
  'select',
  'asset',
  'entity',
  'font',
  'button',
  'group',
  'row',
  'Presets',
]);

const PROP_HELPERS = Object.freeze({
  num, bool, color, text, select, asset, entity, font, button, group, row, Presets,
});

/** The values, in `PROP_HELPER_NAMES` order, for the evaluators to bind. */
export function propHelperValues() {
  return PROP_HELPER_NAMES.map((name) => PROP_HELPERS[name]);
}

/** The same table as an object, for `import { num } from 'blahblah'`. */
export function propHelpers() {
  return PROP_HELPERS;
}

/**
 * The whole table as a default export, so `import props from 'blahblah'`
 * gives one object holding every helper (mirroring the SDK, which also has a
 * default export). scriptBundler.js re-exports that same object shape from the
 * injected globals, so the two spellings agree.
 */
export default PROP_HELPERS;
