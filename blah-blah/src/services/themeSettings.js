/**
 * Persisted theme settings (Settings -> Appearance). Global (not per project)
 * and kept in localStorage, same pattern as autosaveSettings.js /
 * editorSettings.js / keybindSettings.js.
 *
 * ONE THEME, NOT FOUR KNOBS
 *   A theme is chosen as a single thing. Each preset in THEME_PRESETS defines
 *   BOTH an accent (hue + colour-theory harmony rule) and a surface (a tint +
 *   depth for the background chassis), so "Cool Steel" is one coherent look
 *   rather than a colour you pair with a background yourself. Everything below
 *   is derived from that choice:
 *
 *     accent      selection, focus rings, active tabs, the playhead
 *     surface     every panel, lane, menu and border, plus the text ramp
 *     typography  the interface and monospace font stacks
 *     clips       the timeline clip cards
 *     waveform    the audio waveform drawn on those cards
 *
 *   The Settings > Appearance "Details" panel opens up the individual values
 *   (accent hue/saturation, background tint/depth, text colour, fonts, clip
 *   colours), which switches the theme to `custom` — see seedCustomTheme(),
 *   which seeds those values from the preset that was on screen so the first
 *   tweak continues from where the preset left off.
 *
 *   It deliberately does NOT touch the STATUS colours (--unity-accent-emerald/
 *   amber/red), which mean success / warning / error. A theme must never make
 *   "danger" look decorative, so those stay fixed whatever you pick.
 *
 * WHY DERIVED, NOT HAND-PICKED
 *   None of these are lists of hexes to copy around: each is a handful of
 *   numbers plus a rule that generates the whole ramp. That is what keeps the
 *   presets coherent, and it is why the custom controls reuse the exact same
 *   derivation — a tweaked theme is structurally identical to a preset.
 *
 *   The shipped look is always reproducible exactly: the `unity` preset pins
 *   its accent (#38bdf8) and uses a zero-saturation surface, so a fresh install
 *   looks identical until someone actually picks a theme.
 *   tests/theme-settings.test.mjs parses index.css and fails if the :root
 *   fallbacks and the resolved defaults ever disagree.
 */

const STORAGE_KEY = 'blahblah.themeSettings.v1';

/**
 * Fired on window whenever a theme is applied. Canvas painters (a waveform per
 * clip, the curve editor) cannot read CSS variables, so they subscribe through
 * subscribeThemeChanges() below — the same broadcast pattern keybindSettings.js
 * uses for 'blahblah:keybinds-changed'.
 */
export const THEME_CHANGED_EVENT = 'blahblah:theme-changed';

// ===========================================================================
// 1. THEME PRESETS
// ===========================================================================

/**
 * Colour-theory harmony rules. `offset` is how far the secondary accent's hue
 * sits from the base hue on the colour wheel; `label` is what the Appearance
 * tab prints on each preset card.
 */
export const HARMONY_RULES = Object.freeze({
  analogous: {
    offset: 30,
    label: 'Analogous',
    note: 'Neighbouring hues — calm, low-contrast pairings.',
  },
  complementary: {
    offset: 180,
    label: 'Complementary',
    note: 'Opposite hues — maximum separation, the loudest pairing.',
  },
  'split-complementary': {
    offset: 150,
    label: 'Split-complementary',
    note: 'Opposite-ish hues — high contrast without the clash.',
  },
  triadic: {
    offset: 120,
    label: 'Triadic',
    note: 'Evenly spaced hues — vivid but balanced.',
  },
  monochromatic: {
    offset: 0,
    label: 'Monochromatic',
    note: 'One hue throughout — neutral, content-first.',
  },
});

/**
 * The gallery, in display order. Each entry is a complete look:
 *
 *   hue, saturation, harmony   the accent and how its partner colour is derived
 *   accent                     pins the exact bright accent (optional)
 *   surface.hue/saturation     the tint applied to the whole background chassis
 *   surface.depth              scales that chassis darker (<1) or lighter (>1)
 *
 * `unity` reproduces the shipped palette exactly, so a fresh install looks
 * identical until someone actually picks a theme.
 */
export const THEME_PRESETS = Object.freeze([
  {
    id: 'unity',
    label: 'Unity Blue',
    hue: 198,
    saturation: 93,
    harmony: 'analogous',
    // The one preset that pins its bright accent instead of deriving it.
    // #38bdf8 is the colour index.css shipped before theming existed, and an
    // HSL round trip cannot reproduce it exactly: its true lightness is 59.6%,
    // so deriving at the shared 60% lands on #3abff8 (2/255 off). Pinning keeps
    // "select Unity Blue" bit-identical to the shipped palette. Every other
    // role is still derived, like every other preset.
    accent: '#38bdf8',
    surface: { hue: 220, saturation: 0, depth: 1 },
    blurb: 'The shipped accent on neutral graphite — a sky blue that reads as “system”, not “brand”.',
  },
  {
    id: 'steel',
    label: 'Cool Steel',
    hue: 208,
    saturation: 62,
    harmony: 'analogous',
    surface: { hue: 214, saturation: 26, depth: 1 },
    blurb: 'A muted blue accent on blue-grey chrome; the tool-not-toy look.',
  },
  {
    id: 'mono',
    label: 'Mono',
    hue: 210,
    saturation: 8,
    harmony: 'monochromatic',
    surface: { hue: 220, saturation: 8, depth: 1.45 },
    blurb: 'Barely-tinted accent on lifted greys: the theme stops competing with your footage.',
  },
  {
    id: 'cyan',
    label: 'Teal Cyan',
    hue: 187,
    saturation: 85,
    harmony: 'split-complementary',
    surface: { hue: 196, saturation: 20, depth: 0.95 },
    blurb: 'Cool and clinical; the pink secondary keeps it from going flat.',
  },
  {
    id: 'indigo',
    label: 'Deep Indigo',
    hue: 231,
    saturation: 88,
    harmony: 'analogous',
    surface: { hue: 248, saturation: 30, depth: 0.9 },
    blurb: 'Violet-blue accent on deeper violet chrome, for a night-shift feel.',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    hue: 222,
    saturation: 85,
    harmony: 'monochromatic',
    surface: { hue: 222, saturation: 34, depth: 0.55 },
    blurb: 'Near-black saturated panels: maximum contrast, least glare.',
  },
  {
    id: 'violet',
    label: 'Violet',
    hue: 268,
    saturation: 76,
    harmony: 'triadic',
    surface: { hue: 284, saturation: 24, depth: 1 },
    blurb: 'Creative-tool purple, with a warm gold as its triadic partner.',
  },
  {
    id: 'orchid',
    label: 'Orchid',
    hue: 300,
    saturation: 72,
    harmony: 'split-complementary',
    surface: { hue: 302, saturation: 20, depth: 1 },
    blurb: 'Magenta accent on plum panels — the boldest pairing here.',
  },
  {
    id: 'rose',
    label: 'Rose',
    hue: 348,
    saturation: 82,
    harmony: 'complementary',
    surface: { hue: 340, saturation: 16, depth: 1 },
    blurb: 'Rose against its true complement, teal: a classic duotone.',
  },
  {
    id: 'ember',
    label: 'Ember',
    hue: 20,
    saturation: 88,
    harmony: 'complementary',
    surface: { hue: 26, saturation: 22, depth: 1 },
    blurb: 'Warm orange over cyan on brown-tinged charcoal — the warmest theme here.',
  },
  {
    id: 'amber',
    label: 'Amber Gold',
    hue: 42,
    saturation: 92,
    harmony: 'triadic',
    surface: { hue: 40, saturation: 14, depth: 1 },
    blurb: 'Gold with a teal partner, unmistakably different from every red status.',
  },
  {
    id: 'forest',
    label: 'Forest',
    hue: 158,
    saturation: 72,
    harmony: 'split-complementary',
    surface: { hue: 152, saturation: 20, depth: 1 },
    blurb: 'Green accent where the greens are NOT the success status colour.',
  },
]);

/** The id used once the user edits any individual value. */
export const CUSTOM_PRESET_ID = 'custom';

/**
 * Lightness of the bright accent, and the offsets/ratios the rest of the accent
 * ramp is derived with.
 */
const ACCENT_LIGHTNESS = 60;
const ACCENT_STRONG_LIGHTNESS_DELTA = -12;
const ACCENT_SOFT_LIGHTNESS_DELTA = 12;
const ACCENT_MUTED_LIGHTNESS = 35;
/**
 * How far the muted accent's hue rotates off the base hue. 10 degrees is not an
 * invented number: the shipped palette pairs a 198deg accent with a 208deg
 * muted accent (#38bdf8 / #2c5d88), so reusing that shift keeps every preset's
 * "deep" shade the same distance from its bright shade as the original.
 */
const ACCENT_MUTED_HUE_SHIFT = 10;
const ACCENT_MUTED_SATURATION_FACTOR = 0.55;

// ===========================================================================
// 2. SURFACE (the background chassis)
// ===========================================================================

/**
 * Lightness of each surface role, in percent. These ARE the shipped values
 * (`#191919` is exactly hsl(*, 0%, 9.8%)), so a zero-saturation surface at
 * depth 1 reproduces the original palette channel-for-channel.
 */
export const SURFACE_ROLE_LIGHTNESS = Object.freeze({
  darkest: 9.8,
  dark: 12.2,
  panel: 15.7,
  subtle: 19.6,
  hover: 23.5,
  border: 10.2,
  borderLight: 24.3,
});

/**
 * Lightness of each text role, in percent — likewise the shipped values. Used
 * when the text colour is derived from the surface tint.
 */
export const TEXT_ROLE_LIGHTNESS = Object.freeze({
  text: 82.4,
  textMuted: 60,
  textDim: 43.1,
});

/**
 * Where the muted/dim text roles sit relative to the primary one when the user
 * picks a text colour. They are the shipped ratios (60/82.4 and 43.1/82.4), so
 * #d2d2d2 derives exactly #999999 and #6e6e6e — the palette index.css ships.
 */
export const TEXT_LIGHTNESS_RATIOS = Object.freeze({
  textMuted: 0.728,
  textDim: 0.523,
});

/**
 * Text takes only a fraction of the surface's saturation when it is DERIVED. A
 * fully tinted body-text colour is the fastest way to make a themed UI look
 * muddy, and light text exaggerates saturation, so it is halved.
 */
const TEXT_TINT_FACTOR = 0.5;

/** Clamps for the Details sliders (also enforced by the sanitizer). */
export const SURFACE_LIMITS = Object.freeze({
  minSaturation: 0,
  maxSaturation: 40,
  minDepth: 0.5,
  maxDepth: 1.6,
});

// ===========================================================================
// 3. TYPOGRAPHY
// ===========================================================================

/**
 * The shipped stacks. These are literal copies of the `:root` values in
 * index.css (asserted by the test), because --font-sans / --font-mono are what
 * all 44 typography call sites in the stylesheets already read.
 */
export const DEFAULT_FONT_SANS =
  "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
export const DEFAULT_FONT_MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";

/**
 * Font STACKS, not single families: each option ends in a generic family so a
 * machine without the first choice still renders something sane, and the
 * interface option can keep the shipped fallback chain.
 *
 * Deliberately the same idea as the layer above — an option is a stack, the
 * theme stores its id, and the id is what gets validated on load.
 */
export const UI_FONT_PRESETS = Object.freeze([
  { id: 'system', label: 'System default', stack: DEFAULT_FONT_SANS },
  { id: 'inter', label: 'Inter', stack: "'Inter', system-ui, sans-serif" },
  { id: 'segoe', label: 'Segoe UI', stack: "'Segoe UI', system-ui, Roboto, sans-serif" },
  { id: 'roboto', label: 'Roboto', stack: "Roboto, 'Helvetica Neue', Arial, sans-serif" },
  { id: 'helvetica', label: 'Helvetica / Arial', stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: "'Trebuchet MS', Tahoma, sans-serif" },
  { id: 'georgia', label: 'Georgia (serif)', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'times', label: 'Times New Roman (serif)', stack: "'Times New Roman', Times, serif" },
]);

export const MONO_FONT_PRESETS = Object.freeze([
  { id: 'system', label: 'System default', stack: DEFAULT_FONT_MONO },
  { id: 'jetbrains', label: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, monospace" },
  { id: 'fira', label: 'Fira Code', stack: "'Fira Code', ui-monospace, monospace" },
  { id: 'cascadia', label: 'Cascadia Code', stack: "'Cascadia Code', Consolas, ui-monospace, monospace" },
  { id: 'consolas', label: 'Consolas', stack: 'Consolas, Monaco, monospace' },
  { id: 'courier', label: 'Courier New', stack: "'Courier New', Courier, monospace" },
]);

export const DEFAULT_FONT_ID = 'system';

// ===========================================================================
// 4. CLIP CARDS
// ===========================================================================

/** The timeline card categories, in the order the Appearance tab lists them. */
export const CLIP_CATEGORIES = Object.freeze(['video', 'audio', 'text', 'shape', 'prefab']);

/**
 * The shipped per-category card colours, copied from clip-item.css
 * (`.timeline-clip-card.video` ... `.prefab`). These are the DEFAULT clip
 * palette, so "By category" changes nothing about the timeline.
 */
export const CLIP_DEFAULT_COLORS = Object.freeze({
  video: Object.freeze({ background: '#1a2744', accent: '#3b82f6' }),
  audio: Object.freeze({ background: '#1a2233', accent: '#8b5cf6' }),
  text: Object.freeze({ background: '#2a2218', accent: '#f59e0b' }),
  shape: Object.freeze({ background: '#1a2a22', accent: '#10b981' }),
  prefab: Object.freeze({ background: '#2a1a2a', accent: '#ec4899' }),
});

/** The three ways a clip palette can be produced. */
export const CLIP_PALETTE_MODES = Object.freeze(['category', 'accent', 'custom']);

/**
 * Hue offsets, in degrees, added to the accent's hue in the "From accent" clip
 * palette.
 *
 * These are not arbitrary: they are the SHIPPED category hues expressed
 * relative to the shipped accent. The palette in clip-item.css is video 217deg,
 * audio 258deg, text 38deg, shape 160deg and prefab 330deg, and the shipped
 * accent is 198deg — so the numbers below are exactly those differences. The
 * effect is that the whole category family ROTATES with the theme, keeping the
 * relationships a colour-theory scheme is built on (audio a fourth-turn from
 * video, text the near-complementary warm one, shape the cool green) instead of
 * scattering five unrelated hues. With the default accent it lands back on the
 * shipped hues.
 */
export const CLIP_ACCENT_HUE_OFFSETS = Object.freeze({
  video: 19,
  audio: 60,
  text: 200, // 38 - 198, wrapped
  shape: -38, // 160 - 198
  prefab: 132, // 330 - 198
});

/** Card backgrounds sit at this lightness, derived from the category accent. */
const CLIP_BACKGROUND_LIGHTNESS = 17;
/** ...with this fraction of the accent's saturation: dark AND low-chroma. */
const CLIP_BACKGROUND_SATURATION_FACTOR = 0.5;
/**
 * Derived clip accents are clamped into this saturation band: too low and every
 * category turns into the same grey, too high and a hue like 138deg becomes a
 * neon green that fights the footage on the card.
 */
const CLIP_ACCENT_MIN_SATURATION = 55;
const CLIP_ACCENT_MAX_SATURATION = 86;
/** The stripe sits at this lightness so it always reads on a dark card. */
const CLIP_ACCENT_LIGHTNESS = 58;

// ===========================================================================
// 5. WAVEFORM
// ===========================================================================

/**
 * How the audio waveform on a clip card is coloured:
 *   shipped  the fixed violet the timeline has always used (default)
 *   accent   the theme's accent
 *   clip     the card's own category accent
 *   custom   whatever the user picked
 */
export const WAVEFORM_MODES = Object.freeze(['shipped', 'accent', 'clip', 'custom']);

/** The shipped waveform colour (clip-item.css' rgba(139, 92, 246, 0.55)). */
export const WAVEFORM_SHIPPED_COLOR = '#8b5cf6';

/** Alpha every waveform is drawn at, matching the shipped rgba(..., 0.55). */
export const WAVEFORM_ALPHA = 0.55;

// ===========================================================================
// DEFAULTS
// ===========================================================================

/**
 * Only `presetId` decides the look. Every other field is either always
 * meaningful (fonts, clips, waveform) or is the explicit value used once
 * `presetId` becomes CUSTOM_PRESET_ID — at which point seedCustomTheme() has
 * already filled them in from the preset that was on screen.
 */
export const THEME_DEFAULTS = Object.freeze({
  presetId: 'unity',
  // Accent details (custom only)
  accent: '#38bdf8',
  harmony: 'analogous',
  // Surface details (custom only)
  surfaceHue: 220,
  surfaceSaturation: 0,
  surfaceDepth: 1,
  // Text: '' means "derive from the surface tint". Set it to pin a colour.
  textColor: '',
  // Typography is independent of the colour theme, so a preset never changes it.
  fontId: DEFAULT_FONT_ID,
  monoFontId: DEFAULT_FONT_ID,
  // Clips
  clipPalette: 'category',
  clipColors: CLIP_DEFAULT_COLORS,
  // Waveform
  waveformMode: 'shipped',
  waveformColor: WAVEFORM_SHIPPED_COLOR,
});

// ===========================================================================
// CSS CUSTOM PROPERTY CONTRACT
// ===========================================================================

/**
 * Theme group -> CSS custom property. This is the single contract between this
 * service and the stylesheets: add a role here and to the `:root` block in
 * index.css (as the shipped default) and everything that uses the variable
 * follows the theme automatically.
 */
export const THEME_CSS_VARS = Object.freeze({
  accent: Object.freeze({
    accentBright: '--unity-accent-blue', // main interactive accent
    accentStrong: '--unity-accent-blue-strong', // hover / pressed shade
    accentMuted: '--unity-accent', // deep accent (filled buttons)
    accentSoft: '--unity-accent-soft', // light tint (readable on dark panels)
    secondary: '--unity-accent-secondary', // harmony partner, for gradients
    accentRgb: '--unity-accent-rgb', // "R, G, B" channels of accentBright
    secondaryRgb: '--unity-accent-secondary-rgb', // ...of secondary
  }),
  surface: Object.freeze({
    darkest: '--unity-darkest',
    dark: '--unity-dark',
    panel: '--unity-panel',
    subtle: '--unity-subtle',
    hover: '--unity-hover',
    border: '--unity-border',
    borderLight: '--unity-border-light',
    text: '--unity-text',
    textMuted: '--unity-text-muted',
    textDim: '--unity-text-dim',
  }),
  typography: Object.freeze({
    fontSans: '--font-sans',
    fontMono: '--font-mono',
  }),
  waveform: Object.freeze({
    // Bare RGB channels, so CSS can write rgba(var(--unity-waveform-rgb), a).
    // Canvas cannot, which is why resolveWaveformColor() exists.
    rgb: '--unity-waveform-rgb',
  }),
});

/**
 * Clip colour -> CSS custom property, per category. Namespaced (`--clip-*`)
 * because these describe content, not chrome: a theme that recolours panels
 * should not accidentally recolour the cards on top of them.
 */
export const CLIP_CSS_VARS = Object.freeze(
  Object.fromEntries(
    CLIP_CATEGORIES.map((category) => [
      category,
      Object.freeze({
        background: `--clip-${category}-bg`,
        accent: `--clip-${category}-accent`,
      }),
    ])
  )
);

// ===========================================================================
// COLOUR MATHS
// ===========================================================================

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** True for a `#rrggbb` string (shorthand `#abc` is not accepted — be strict). */
export function isValidHexColor(value) {
  return typeof value === 'string' && HEX_COLOR.test(value.trim());
}

function normalizeHue(hue) {
  return ((hue % 360) + 360) % 360;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** A missing/invalid colour falls back to `fallback` (the shipped accent). */
function safeHex(value, fallback = THEME_DEFAULTS.accent) {
  return isValidHexColor(value) ? value.trim().toLowerCase() : fallback;
}

/**
 * HSL -> `#rrggbb`. The standard CSS conversion, rounded to 8-bit channels.
 * Written out here rather than pulled from a dependency: several callers need
 * it and the app has no colour library.
 */
export function hslToHex(hue, saturation, lightness) {
  const h = normalizeHue(hue);
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const toHex = (n) =>
    Math.round(255 * f(n))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

/** `#rrggbb` -> `{ hue, saturation, lightness }` as floats (not rounded). */
function hexToHslRaw(hex, fallback = THEME_DEFAULTS.accent) {
  const safe = safeHex(hex, fallback);
  const r = parseInt(safe.slice(1, 3), 16) / 255;
  const g = parseInt(safe.slice(3, 5), 16) / 255;
  const b = parseInt(safe.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;
  if (max !== min) {
    const delta = max - min;
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
  }
  return { hue: normalizeHue(hue), saturation: saturation * 100, lightness: lightness * 100 };
}

/**
 * The rounded public form. Rounding is right for DISPLAY (the Appearance tab's
 * "198 deg / 93%" readouts) but wrong for derivation: a text colour's muted roles
 * are lightness ratios of the exact value, and rounding 82.35% to 82% first
 * lands the shipped muted grey on #989898 instead of #999999.
 */
export function hexToHsl(hex, fallback = THEME_DEFAULTS.accent) {
  const { hue, saturation, lightness } = hexToHslRaw(hex, fallback);
  return {
    hue: Math.round(hue),
    saturation: Math.round(saturation),
    lightness: Math.round(lightness),
  };
}

/** `#rrggbb` -> `"r, g, b"`, the form `rgba(var(--x), a)` needs. */
export function hexToRgbChannels(hex, fallback) {
  const safe = safeHex(hex, fallback);
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

/** `#rrggbb` -> `rgba(r, g, b, a)`, for canvas painters that cannot use var(). */
export function hexToRgba(hex, alpha = 1, fallback) {
  const safe = safeHex(hex, fallback);
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex, fallback) {
  const safe = safeHex(hex, fallback);
  const channel = (offset) => {
    const c = parseInt(safe.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * WCAG contrast ratio between two colours, from 1 (identical) to 21 (black on
 * white). Used by the Appearance tab to warn when a hand-picked text colour is
 * unreadable against the themed panel — the one thing a custom text colour can
 * genuinely get wrong.
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// ===========================================================================
// DERIVATION
// ===========================================================================

/** Look up a theme preset by id (undefined when the id is unknown). */
export function getThemePreset(id) {
  return THEME_PRESETS.find((preset) => preset.id === id);
}

/** The preset for an id, or the default when the id is missing/unknown. */
export function resolveThemePreset(id) {
  return getThemePreset(id) || getThemePreset(THEME_DEFAULTS.presetId);
}

/**
 * Derive the full accent ramp from a base hue + saturation + harmony rule.
 *
 * `brightHex` lets a custom accent keep the EXACT colour the user typed as the
 * bright accent (round-tripping through HSL would drift it by a channel or
 * two), while every other role is still derived from that colour's
 * hue/saturation — which is what keeps custom themes structurally identical to
 * the presets.
 */
export function buildThemePalette({ hue, saturation, lightness = ACCENT_LIGHTNESS, harmony = 'analogous', brightHex } = {}) {
  const rule = HARMONY_RULES[harmony] || HARMONY_RULES[THEME_DEFAULTS.harmony];
  const baseHue = normalizeHue(Number.isFinite(hue) ? hue : 198);
  const baseSaturation = clamp(Number.isFinite(saturation) ? saturation : 93, 0, 100);
  const baseLightness = clamp(Number.isFinite(lightness) ? lightness : ACCENT_LIGHTNESS, 5, 95);

  const accentBright = isValidHexColor(brightHex) ? brightHex.trim().toLowerCase() : hslToHex(baseHue, baseSaturation, baseLightness);
  const secondary = hslToHex(baseHue + rule.offset, baseSaturation, baseLightness);

  return {
    accentBright,
    accentStrong: hslToHex(baseHue, baseSaturation, clamp(baseLightness + ACCENT_STRONG_LIGHTNESS_DELTA, 15, 70)),
    accentMuted: hslToHex(
      baseHue + ACCENT_MUTED_HUE_SHIFT,
      baseSaturation * ACCENT_MUTED_SATURATION_FACTOR,
      ACCENT_MUTED_LIGHTNESS
    ),
    accentSoft: hslToHex(baseHue, baseSaturation, clamp(baseLightness + ACCENT_SOFT_LIGHTNESS_DELTA, 45, 88)),
    secondary,
    accentRgb: hexToRgbChannels(accentBright),
    secondaryRgb: hexToRgbChannels(secondary),
  };
}

/**
 * The text ramp from one colour: the chosen colour becomes the primary text
 * colour EXACTLY (pass it as `hex` — round-tripping through HSL would drift it
 * by a channel), and the muted/dim roles are the shipped lightness RATIOS of
 * it, so a picked colour keeps the shipped spacing between the three roles
 * instead of collapsing into three near-identical greys.
 */
export function buildTextPalette({ hue, saturation, lightness, hex } = {}) {
  const base = isValidHexColor(hex)
    ? hex.trim().toLowerCase()
    : hslToHex(hue ?? 0, saturation ?? 0, lightness ?? TEXT_ROLE_LIGHTNESS.text);
  const { hue: h, saturation: s, lightness: l } = hexToHslRaw(base, '#d2d2d2');
  return {
    text: base,
    textMuted: hslToHex(h, s, clamp(l * TEXT_LIGHTNESS_RATIOS.textMuted, 8, 92)),
    textDim: hslToHex(h, s, clamp(l * TEXT_LIGHTNESS_RATIOS.textDim, 5, 80)),
  };
}

/**
 * Derive the background chassis: the surface ramp (panels, lanes, menus,
 * borders) and the text ramp, from a tint plus a depth multiplier.
 *
 * With `saturation: 0` and `depth: 1` this returns the shipped greys exactly
 * (see SURFACE_ROLE_LIGHTNESS), which is what the `unity` preset relies on.
 *
 * `textColor` (optional) pins the text ramp to an exact colour instead of
 * tinting the grey one — that is the Appearance tab's "Text colour" control.
 */
export function buildSurfacePalette({ hue = 220, saturation = 0, depth = 1, textColor = '' } = {}) {
  const baseHue = normalizeHue(Number.isFinite(hue) ? hue : 220);
  const baseSaturation = clamp(Number.isFinite(saturation) ? saturation : 0, 0, 100);
  const depthScale = clamp(
    Number.isFinite(depth) ? depth : 1,
    SURFACE_LIMITS.minDepth,
    SURFACE_LIMITS.maxDepth
  );

  const palette = {};
  for (const [role, lightness] of Object.entries(SURFACE_ROLE_LIGHTNESS)) {
    // Depth scales the surface roles only. Text must stay legible, and since it
    // is light-on-dark a darker chassis only ever increases its contrast, so
    // lifting/darkening the panels never requires touching the text ramp.
    palette[role] = hslToHex(baseHue, baseSaturation, clamp(lightness * depthScale, 2, 45));
  }

  if (isValidHexColor(textColor)) {
    Object.assign(palette, buildTextPalette({ hex: textColor }));
  } else {
    for (const [role, lightness] of Object.entries(TEXT_ROLE_LIGHTNESS)) {
      palette[role] = hslToHex(baseHue, baseSaturation * TEXT_TINT_FACTOR, lightness);
    }
  }
  return palette;
}

/**
 * The accent + background for one clip category, derived from a single accent
 * colour: bright saturated stripe, dark low-chroma card behind it.
 */
export function buildClipColors(accentHex) {
  const accent = safeHex(accentHex, CLIP_DEFAULT_COLORS.video.accent);
  const { hue, saturation } = hexToHsl(accent, CLIP_DEFAULT_COLORS.video.accent);
  return {
    accent,
    background: hslToHex(hue, saturation * CLIP_BACKGROUND_SATURATION_FACTOR, CLIP_BACKGROUND_LIGHTNESS),
  };
}

// ===========================================================================
// RESOLUTION (settings -> concrete values)
// ===========================================================================

/** The accent ramp for a settings object. */
export function resolveThemePalette(settings) {
  const { presetId, accent, harmony } = sanitizeThemeSettings(settings);
  if (presetId === CUSTOM_PRESET_ID) {
    const { hue, saturation, lightness } = hexToHsl(accent);
    return buildThemePalette({ hue, saturation, lightness, harmony, brightHex: accent });
  }
  const preset = resolveThemePreset(presetId);
  return buildThemePalette({
    hue: preset.hue,
    saturation: preset.saturation,
    harmony: preset.harmony,
    brightHex: preset.accent, // only set by presets that pin one (see above)
  });
}

/** The background chassis (panels + text) for a settings object. */
export function resolveSurfacePalette(settings) {
  const { presetId, surfaceHue, surfaceSaturation, surfaceDepth, textColor } = sanitizeThemeSettings(settings);
  if (presetId === CUSTOM_PRESET_ID) {
    return buildSurfacePalette({
      hue: surfaceHue,
      saturation: surfaceSaturation,
      depth: surfaceDepth,
      textColor,
    });
  }
  const preset = resolveThemePreset(presetId);
  return buildSurfacePalette({ ...preset.surface, textColor });
}

/** The font stacks for a settings object. */
export function resolveTypography(settings) {
  const { fontId, monoFontId } = sanitizeThemeSettings(settings);
  const ui = UI_FONT_PRESETS.find((font) => font.id === fontId) || UI_FONT_PRESETS[0];
  const mono = MONO_FONT_PRESETS.find((font) => font.id === monoFontId) || MONO_FONT_PRESETS[0];
  return { fontSans: ui.stack, fontMono: mono.stack, uiLabel: ui.label, monoLabel: mono.label };
}

/**
 * The per-category clip colours for a settings object.
 *
 *   category  the shipped hand-tuned set (clip-item.css' own literals)
 *   accent    the shipped category relationships rotated with the theme accent,
 *             so the cards stay distinguishable but obviously belong together
 *   custom    one accent per category, each with its background derived
 */
export function resolveClipPalette(settings) {
  const { clipPalette, clipColors } = sanitizeThemeSettings(settings);

  if (clipPalette === 'category') {
    return Object.fromEntries(
      CLIP_CATEGORIES.map((category) => [category, { ...CLIP_DEFAULT_COLORS[category] }])
    );
  }

  if (clipPalette === 'accent') {
    const { hue, saturation } = hexToHsl(resolveThemePalette(settings).accentBright);
    const accentSaturation = clamp(saturation, CLIP_ACCENT_MIN_SATURATION, CLIP_ACCENT_MAX_SATURATION);
    return Object.fromEntries(
      CLIP_CATEGORIES.map((category) => [
        category,
        buildClipColors(hslToHex(hue + CLIP_ACCENT_HUE_OFFSETS[category], accentSaturation, CLIP_ACCENT_LIGHTNESS)),
      ])
    );
  }

  return Object.fromEntries(
    CLIP_CATEGORIES.map((category) => {
      const accent = clipColors[category] || CLIP_DEFAULT_COLORS[category].accent;
      // A category left at its shipped accent keeps its shipped background too,
      // so switching to custom and changing one category does not restyle the
      // other four.
      const isShipped = accent === CLIP_DEFAULT_COLORS[category].accent;
      return [
        category,
        isShipped
          ? { ...CLIP_DEFAULT_COLORS[category] }
          : buildClipColors(accent),
      ];
    })
  );
}

/**
 * The waveform colour for a settings object as a hex, before alpha.
 * `category` only matters in 'clip' mode (a waveform takes the colour of the
 * card it sits on).
 */
export function resolveWaveformHex(settings, category = 'audio') {
  const { waveformMode, waveformColor } = sanitizeThemeSettings(settings);
  if (waveformMode === 'accent') return resolveThemePalette(settings).accentBright;
  if (waveformMode === 'clip') {
    const clips = resolveClipPalette(settings);
    return (clips[category] || clips.audio || CLIP_DEFAULT_COLORS.audio).accent;
  }
  if (waveformMode === 'custom') return waveformColor;
  return WAVEFORM_SHIPPED_COLOR;
}

/**
 * The waveform colour as a canvas-ready rgba() string. Every waveform painter
 * (WaveformCanvas via ClipItem, drawTimeline's card pass) needs a resolved
 * colour, not a var() reference — this is the one place that decision is made.
 */
export function resolveWaveformColor(settings, category = 'audio') {
  return hexToRgba(resolveWaveformHex(settings, category), WAVEFORM_ALPHA, WAVEFORM_SHIPPED_COLOR);
}

/** The harmony rule actually in force for a settings object. */
export function resolveThemeHarmony(settings) {
  const { presetId, harmony } = sanitizeThemeSettings(settings);
  if (presetId === CUSTOM_PRESET_ID) return harmony;
  return resolveThemePreset(presetId).harmony;
}

/**
 * Everything the theme resolves to, in one object. This is what applyTheme
 * writes out and what the Appearance tab previews.
 */
export function resolveTheme(settings) {
  const sanitized = sanitizeThemeSettings(settings);
  const accent = resolveThemePalette(sanitized);
  const surface = resolveSurfacePalette(sanitized);
  const clips = resolveClipPalette(sanitized);
  const typography = resolveTypography(sanitized);
  const waveformHex = resolveWaveformHex(sanitized);
  return {
    settings: sanitized,
    accent,
    surface,
    typography,
    clips,
    waveform: {
      hex: waveformHex,
      rgb: hexToRgbChannels(waveformHex, WAVEFORM_SHIPPED_COLOR),
    },
  };
}

/**
 * Turn a settings object into an explicitly-custom one, seeding the individual
 * values from whatever is on screen right now and then applying `patch`.
 *
 * This is what makes "presets, and a Details panel" coherent: the first time
 * the user touches any individual control, the theme stops being the preset and
 * becomes a custom theme that BEGINS at the preset's values. Without the
 * seeding the first slider move would jump the whole UI to the defaults, which
 * is both surprising and loses the user's place.
 *
 * Already-custom themes are patched in place, so dragging a slider does not
 * re-seed from a stale preset on every frame.
 */
export function seedCustomTheme(settings, patch = {}) {
  const base = sanitizeThemeSettings(settings);
  if (base.presetId === CUSTOM_PRESET_ID) return sanitizeThemeSettings({ ...base, ...patch });

  const preset = resolveThemePreset(base.presetId);
  return sanitizeThemeSettings({
    ...base,
    presetId: CUSTOM_PRESET_ID,
    accent: resolveThemePalette(base).accentBright,
    harmony: preset.harmony,
    surfaceHue: preset.surface.hue,
    surfaceSaturation: preset.surface.saturation,
    surfaceDepth: preset.surface.depth,
    ...patch,
  });
}

// ===========================================================================
// PERSISTENCE
// ===========================================================================

/** Coerce a stored value into a clamped number, or `fallback` when unusable. */
function toClampedNumber(value, min, max, fallback, decimals = 0) {
  const isNumeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  const n = isNumeric ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const factor = 10 ** decimals;
  return Math.min(max, Math.max(min, Math.round(n * factor) / factor));
}

/** Coerce any stored/partial value into a complete, usable settings object. */
export function sanitizeThemeSettings(candidate) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};

  const knownPreset = Boolean(getThemePreset(c.presetId)) || c.presetId === CUSTOM_PRESET_ID;

  const storedClipColors = c.clipColors && typeof c.clipColors === 'object' ? c.clipColors : {};
  const clipColors = {};
  for (const category of CLIP_CATEGORIES) {
    clipColors[category] = isValidHexColor(storedClipColors[category])
      ? storedClipColors[category].trim().toLowerCase()
      : CLIP_DEFAULT_COLORS[category].accent;
  }

  const knownFont = (list, id) => Boolean(list.some((font) => font.id === id));

  return {
    presetId: knownPreset ? c.presetId : THEME_DEFAULTS.presetId,

    // ---- accent details (used when presetId === 'custom') ----
    // Lower-cased so a `<input type="color">` value and a stored one compare
    // equal (browsers emit lowercase, but hand-edited storage may not).
    accent: safeHex(c.accent),
    harmony: HARMONY_RULES[c.harmony] ? c.harmony : THEME_DEFAULTS.harmony,

    // ---- surface details (likewise) ----
    surfaceHue: toClampedNumber(c.surfaceHue, 0, 359, THEME_DEFAULTS.surfaceHue),
    surfaceSaturation: toClampedNumber(
      c.surfaceSaturation,
      SURFACE_LIMITS.minSaturation,
      SURFACE_LIMITS.maxSaturation,
      THEME_DEFAULTS.surfaceSaturation
    ),
    surfaceDepth: toClampedNumber(
      c.surfaceDepth,
      SURFACE_LIMITS.minDepth,
      SURFACE_LIMITS.maxDepth,
      THEME_DEFAULTS.surfaceDepth,
      2
    ),

    // ---- text ----
    // '' is meaningful ("derive from the surface tint"), so an invalid value
    // clears the pin rather than falling back to a colour.
    textColor: isValidHexColor(c.textColor) ? c.textColor.trim().toLowerCase() : '',
    fontId: knownFont(UI_FONT_PRESETS, c.fontId) ? c.fontId : THEME_DEFAULTS.fontId,
    monoFontId: knownFont(MONO_FONT_PRESETS, c.monoFontId) ? c.monoFontId : THEME_DEFAULTS.monoFontId,

    // ---- clips ----
    clipPalette: CLIP_PALETTE_MODES.includes(c.clipPalette) ? c.clipPalette : THEME_DEFAULTS.clipPalette,
    clipColors,

    // ---- waveform ----
    waveformMode: WAVEFORM_MODES.includes(c.waveformMode) ? c.waveformMode : THEME_DEFAULTS.waveformMode,
    waveformColor: safeHex(c.waveformColor, WAVEFORM_SHIPPED_COLOR),
  };
}

export function loadThemeSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return sanitizeThemeSettings(THEME_DEFAULTS);
    return sanitizeThemeSettings(JSON.parse(raw));
  } catch {
    return sanitizeThemeSettings(THEME_DEFAULTS);
  }
}

/** Persists and returns the sanitized settings that were actually stored. */
export function saveThemeSettings(settings) {
  const sanitized = sanitizeThemeSettings(settings);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage errors (private browsing, quota, etc.)
  }
  return sanitized;
}

// ===========================================================================
// APPLICATION
// ===========================================================================

function rootOrNull(root) {
  if (root !== undefined) return root;
  return typeof document !== 'undefined' ? document.documentElement : null;
}

/**
 * Write a resolved theme onto an element's inline style (the document root by
 * default). Safe to call with no DOM (tests, SSR) — it simply does nothing.
 */
export function applyTheme(theme, root) {
  const el = rootOrNull(root);
  if (!el || !el.style?.setProperty) return;
  const resolved = theme && theme.accent ? theme : resolveTheme(THEME_DEFAULTS);

  for (const group of ['accent', 'surface', 'typography', 'waveform']) {
    const values = resolved[group];
    if (!values) continue;
    for (const [role, cssVar] of Object.entries(THEME_CSS_VARS[group])) {
      if (values[role]) el.style.setProperty(cssVar, values[role]);
    }
  }
  for (const category of CLIP_CATEGORIES) {
    const clip = resolved.clips?.[category];
    if (!clip) continue;
    el.style.setProperty(CLIP_CSS_VARS[category].background, clip.background);
    el.style.setProperty(CLIP_CSS_VARS[category].accent, clip.accent);
  }
}

/**
 * Apply a whole settings object: resolves every axis, writes the CSS custom
 * properties, and stamps a `data-theme` attribute on the root so stylesheets
 * (or a future light mode) can branch on the theme without reading the palette
 * back out.
 *
 * Returns the resolved theme, so callers/tests can assert on exactly what was
 * applied.
 */
export function applyThemeSettings(settings, root) {
  const el = rootOrNull(root);
  const resolved = resolveTheme(settings);
  applyTheme(resolved, el);
  if (el && 'dataset' in el) {
    const { presetId, clipPalette, harmony } = resolved.settings;
    const presetTag = presetId === CUSTOM_PRESET_ID ? `custom:${harmony}` : presetId;
    el.dataset.theme = `${presetTag}/${clipPalette}`;
  }
  return resolved;
}

/**
 * Drop every inline override, falling back to the `:root` defaults in
 * index.css (i.e. exactly the shipped palette). Used when the theme is reset.
 */
export function clearAppliedTheme(root) {
  const el = rootOrNull(root);
  if (!el || !el.style?.removeProperty) return;
  const all = [
    ...Object.values(THEME_CSS_VARS).flatMap((group) => Object.values(group)),
    ...CLIP_CATEGORIES.flatMap((category) => Object.values(CLIP_CSS_VARS[category])),
  ];
  for (const cssVar of all) el.style.removeProperty(cssVar);
  if ('dataset' in el) delete el.dataset.theme;
}

/**
 * The current bright accent as a CONCRETE colour, for canvas code: a
 * `CanvasRenderingContext2D.fillStyle` cannot resolve `var(--unity-accent-blue)`
 * the way CSS can, so canvas painters read the live value here (or keep using
 * the literals in drawTimeline's FALLBACK when there is no DOM, e.g. tests).
 */
export function readThemeAccent(element) {
  return readCssValue(THEME_CSS_VARS.accent.accentBright, THEME_DEFAULTS.accent, element);
}

/** Read one theme custom property off the document as a concrete string. */
export function readCssValue(cssVar, fallback, element) {
  const el = rootOrNull(element);
  if (!el || typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(el).getPropertyValue(cssVar);
  return value && value.trim() ? value.trim() : fallback;
}

/**
 * The theme currently applied, cached in this module.
 *
 * Canvas painters (a waveform per clip, the curve editor) each need the live
 * theme, and there can be hundreds of them mounted at once. Reading
 * localStorage per component would be wasteful and, worse, would leave them out
 * of sync with a theme change that has already been applied. This cache is
 * maintained by notifyThemeChanged/subscribeThemeChanges below, so every
 * subscriber sees the same value the moment it changes.
 */
let liveThemeSettings = null;
const themeListeners = new Set();
let isWindowBound = false;

/** The theme in force right now (loading it from storage on first use). */
export function getLiveThemeSettings() {
  if (!liveThemeSettings) liveThemeSettings = loadThemeSettings();
  return liveThemeSettings;
}

/**
 * Subscribe to theme changes without touching the window directly. The window
 * listener is bound ONCE for the whole app no matter how many components
 * subscribe, which is what makes this safe to call from a per-clip component.
 * Returns an unsubscribe function.
 */
export function subscribeThemeChanges(callback) {
  if (!isWindowBound && typeof window !== 'undefined') {
    window.addEventListener(THEME_CHANGED_EVENT, (event) => {
      liveThemeSettings = sanitizeThemeSettings(event?.detail || liveThemeSettings || undefined);
      for (const listener of themeListeners) listener(liveThemeSettings);
    });
    isWindowBound = true;
  }
  themeListeners.add(callback);
  return () => themeListeners.delete(callback);
}

/**
 * Broadcast that the theme changed (see THEME_CHANGED_EVENT) and refresh this
 * module's cache, so subscribers and any later getLiveThemeSettings() agree.
 */
export function notifyThemeChanged(settings, target = typeof window !== 'undefined' ? window : null) {
  liveThemeSettings = sanitizeThemeSettings(settings);
  if (!target || typeof target.dispatchEvent !== 'function') return;
  target.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: liveThemeSettings }));
}
