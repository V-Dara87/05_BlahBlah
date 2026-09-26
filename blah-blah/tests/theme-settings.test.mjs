import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CLIP_ACCENT_HUE_OFFSETS,
  CLIP_CATEGORIES,
  CLIP_CSS_VARS,
  CLIP_DEFAULT_COLORS,
  CLIP_PALETTE_MODES,
  CUSTOM_PRESET_ID,
  DEFAULT_FONT_MONO,
  DEFAULT_FONT_SANS,
  HARMONY_RULES,
  MONO_FONT_PRESETS,
  SURFACE_LIMITS,
  SURFACE_ROLE_LIGHTNESS,
  TEXT_LIGHTNESS_RATIOS,
  TEXT_ROLE_LIGHTNESS,
  THEME_CSS_VARS,
  THEME_DEFAULTS,
  THEME_PRESETS,
  UI_FONT_PRESETS,
  WAVEFORM_ALPHA,
  WAVEFORM_MODES,
  WAVEFORM_SHIPPED_COLOR,
  applyTheme,
  applyThemeSettings,
  buildClipColors,
  buildSurfacePalette,
  buildTextPalette,
  buildThemePalette,
  clearAppliedTheme,
  contrastRatio,
  getLiveThemeSettings,
  getThemePreset,
  hexToHsl,
  hexToRgbChannels,
  hexToRgba,
  hslToHex,
  isValidHexColor,
  loadThemeSettings,
  notifyThemeChanged,
  readCssValue,
  resolveClipPalette,
  resolveSurfacePalette,
  resolveTheme,
  resolveThemeHarmony,
  resolveThemePalette,
  resolveTypography,
  resolveWaveformColor,
  resolveWaveformHex,
  sanitizeThemeSettings,
  saveThemeSettings,
  seedCustomTheme,
  subscribeThemeChanges,
} from '../src/services/themeSettings.js';

/** The palette index.css shipped before any theming existed. */
const SHIPPED_SURFACE = Object.freeze({
  darkest: '#191919',
  dark: '#1f1f1f',
  panel: '#282828',
  subtle: '#323232',
  hover: '#3c3c3c',
  border: '#1a1a1a',
  borderLight: '#3e3e3e',
  text: '#d2d2d2',
  textMuted: '#999999',
  textDim: '#6e6e6e',
});

/** Minimal documentElement stand-in: applyTheme only needs style + dataset. */
function fakeRoot() {
  const props = {};
  return {
    props,
    dataset: {},
    style: {
      setProperty: (name, value) => {
        props[name] = value;
      },
      removeProperty: (name) => {
        delete props[name];
      },
    },
  };
}

/** In-memory localStorage for the load/save round trips. */
function withFakeStorage(run) {
  const store = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  try {
    return run(store);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
}

/** Every CSS custom property the theme owns, as [name, expectedValue] pairs. */
function defaultThemeVars() {
  const theme = resolveTheme(THEME_DEFAULTS);
  const pairs = [];
  for (const group of ['accent', 'surface', 'typography', 'waveform']) {
    for (const [role, cssVar] of Object.entries(THEME_CSS_VARS[group])) {
      pairs.push([cssVar, theme[group][role]]);
    }
  }
  for (const category of CLIP_CATEGORIES) {
    pairs.push([CLIP_CSS_VARS[category].background, theme.clips[category].background]);
    pairs.push([CLIP_CSS_VARS[category].accent, theme.clips[category].accent]);
  }
  return pairs;
}

/** Read one declaration out of index.css' :root block. */
function readRootDeclaration(name) {
  const cssPath = fileURLToPath(new URL('../src/index.css', import.meta.url));
  const css = readFileSync(cssPath, 'utf8');
  const start = css.indexOf(':root');
  const root = css.slice(start, css.indexOf('}', start));
  const match = root.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return match && match[1].trim();
}

// ===========================================================================
// The unified preset gallery
// ===========================================================================

test('the theme gallery ships a full set of one-piece looks, each with a valid harmony', () => {
  assert.ok(THEME_PRESETS.length >= 10, 'at least ten themes');
  assert.equal(new Set(THEME_PRESETS.map((p) => p.id)).size, THEME_PRESETS.length, 'ids are unique');

  for (const preset of THEME_PRESETS) {
    assert.ok(preset.hue >= 0 && preset.hue < 360, `${preset.id}: hue in [0,360)`);
    assert.ok(preset.saturation >= 0 && preset.saturation <= 100, `${preset.id}: saturation in [0,100]`);
    assert.ok(HARMONY_RULES[preset.harmony], `${preset.id}: known harmony rule`);
    assert.ok(preset.blurb && preset.blurb.length > 10, `${preset.id}: has an explanation`);

    // Every theme carries its OWN background, so an accent can never be paired
    // with a chassis chosen separately.
    assert.ok(preset.surface, `${preset.id}: has a surface`);
    assert.ok(preset.surface.hue >= 0 && preset.surface.hue < 360, `${preset.id}: surface hue`);
    assert.ok(
      preset.surface.saturation >= SURFACE_LIMITS.minSaturation &&
        preset.surface.saturation <= SURFACE_LIMITS.maxSaturation,
      `${preset.id}: surface saturation within the slider limits`
    );
    assert.ok(
      preset.surface.depth >= SURFACE_LIMITS.minDepth && preset.surface.depth <= SURFACE_LIMITS.maxDepth,
      `${preset.id}: surface depth within the slider limits`
    );
  }

  // The rules actually get used: a gallery where every theme is analogous would
  // not be a colour-theory tour, and the neutral one must stay neutral.
  const rulesUsed = new Set(THEME_PRESETS.map((p) => p.harmony));
  assert.ok(rulesUsed.size >= 4, `uses several harmony rules, got ${[...rulesUsed].join(', ')}`);
  assert.ok(rulesUsed.has('monochromatic'), 'the neutral theme is monochromatic');
  assert.equal(
    new Set(THEME_PRESETS.map((p) => p.hue)).size,
    THEME_PRESETS.length,
    'no two themes share a hue'
  );
});

test('choosing the default theme changes nothing about the shipped look', () => {
  // A fresh install must look byte-identical to the app before theming existed,
  // so the neutral preset resolves to the exact literals index.css shipped.
  const theme = resolveTheme(THEME_DEFAULTS);

  assert.equal(theme.settings.presetId, 'unity');
  assert.equal(theme.accent.accentBright, '#38bdf8');
  assert.equal(theme.accent.accentRgb, '56, 189, 248');

  for (const [role, hex] of Object.entries(SHIPPED_SURFACE)) {
    assert.equal(theme.surface[role], hex, `${role} is the shipped value`);
  }

  for (const category of CLIP_CATEGORIES) {
    assert.equal(theme.clips[category].accent, CLIP_DEFAULT_COLORS[category].accent, `${category} accent`);
    assert.equal(theme.clips[category].background, CLIP_DEFAULT_COLORS[category].background, `${category} background`);
  }

  assert.equal(resolveWaveformColor(THEME_DEFAULTS), 'rgba(139, 92, 246, 0.55)');
  assert.equal(theme.typography.fontSans, DEFAULT_FONT_SANS, 'shipped interface stack');
  assert.equal(theme.typography.fontMono, DEFAULT_FONT_MONO, 'shipped monospace stack');
});

test('every theme resolves a distinct, readable accent + chassis', () => {
  const accents = THEME_PRESETS.map((preset) => resolveThemePalette({ presetId: preset.id }).accentBright);
  assert.equal(new Set(accents).size, THEME_PRESETS.length, 'each theme resolves to a different accent');

  for (const preset of THEME_PRESETS) {
    const theme = resolveTheme({ presetId: preset.id });
    assert.match(theme.accent.accentBright, /^#[0-9a-f]{6}$/);

    for (const role of ['accentStrong', 'accentMuted', 'accentSoft', 'secondary']) {
      assert.match(theme.accent[role], /^#[0-9a-f]{6}$/, `${preset.id}: ${role} derived`);
      assert.ok(hexToRgbChannels(theme.accent[role]), `${preset.id}: ${role} convertible`);
    }
    assert.equal(theme.accent.accentRgb, hexToRgbChannels(theme.accent.accentBright));
    assert.equal(theme.accent.secondaryRgb, hexToRgbChannels(theme.accent.secondary));

    // A theme changes the greys, and it must never change them into something
    // the text cannot be read against: this is the promise the depth slider
    // makes, so it is asserted for EVERY preset, not just the neutral one.
    assert.ok(
      contrastRatio(theme.surface.text, theme.surface.panel) >= 4.5,
      `${preset.id}: body text stays readable on its own panel`
    );
    // The chassis keeps its light-to-dark order whatever the tint is.
    const ramp = ['darkest', 'dark', 'panel', 'subtle', 'hover'].map((role) => theme.surface[role]);
    for (let i = 1; i < ramp.length; i += 1) {
      assert.ok(
        hexToHsl(ramp[i]).lightness > hexToHsl(ramp[i - 1]).lightness,
        `${preset.id}: surface ramp stays ordered at ${ramp[i]}`
      );
    }
  }
});

test('the :root fallbacks in index.css match the default theme exactly', () => {
  // The stylesheet's values are the pre-JS fallback; main.jsx overwrites them
  // with resolveTheme()'s output before the first paint. If the two ever
  // disagree there would be a visible flicker of the wrong colour, so parse the
  // real CSS and compare rather than trusting the copies to stay in sync.
  for (const [cssVar, expected] of defaultThemeVars()) {
    assert.equal(readRootDeclaration(cssVar.replace(/^--/, '')), expected, `${cssVar} in :root`);
  }
});

test('no stylesheet freezes a themed colour as a literal any more', () => {
  // The whole feature depends on stylesheets reading var(--unity-*) / var(--clip-*).
  // A reintroduced literal would silently opt that rule out of theming, which is
  // exactly the bug this work fixed. `var(--x, #fallback)` is allowed: that is a
  // deliberate fallback, not a frozen colour.
  const files = [
    '../src/index.css',
    '../src/styles/shared.css',
    '../src/App.css',
    '../src/app-shell.css',
    '../src/dock/dockview-unity-theme.css',
    '../src/components/Timeline/clip-item.css',
    '../src/components/Timeline/timeline.css',
    '../src/components/unity-inspector.css',
    '../src/components/project-panel.css',
    '../src/components/shell/unity-header.css',
    '../src/components/shell/hub-screen.css',
    '../src/components/modals/settings-modal.css',
  ];
  const frozen = [
    /#38bdf8/i, // accent
    /rgba\(\s*56,\s*189,\s*248/, // accent channels
    /#191919/i, // surface: darkest
    /#282828/i, // surface: panel
    /#323232/i, // surface: subtle
    /#1a2744/i, // clip: video background
    /#1a2233/i, // clip: audio background
    /#2a2218/i, // clip: text background
    /#1a2a22/i, // clip: shape background
    /#2a1a2a/i, // clip: prefab background
    /rgba\(\s*139,\s*92,\s*246/, // waveform
  ];

  for (const relative of files) {
    const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
    const body = source
      .replace(/:root\s*\{[\s\S]*?\}/, '') // the defaults are literals on purpose
      .replace(/var\([^)]*,\s*#[0-9a-f]{3,8}\s*\)/gi, ''); // allow var(--x, #fallback)
    for (const pattern of frozen) {
      assert.ok(!pattern.test(body), `${relative} still hard-codes ${pattern} outside :root`);
    }
  }
});

test('the status colours are never themed', () => {
  // Success / warning / error carry meaning. If a theme could re-colour them,
  // picking "Rose" would make a red banner decorative, so they stay fixed
  // literals in :root and no theme preset references them.
  const source = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8');
  for (const [name, hex] of [
    ['unity-accent-emerald', '#10b981'],
    ['unity-accent-amber', '#f59e0b'],
    ['unity-accent-red', '#ef4444'],
  ]) {
    assert.equal(readRootDeclaration(name), hex, `${name} keeps its shipped value`);
  }
  // ...and nothing in the theme CONTRACT mentions them, so there is no code path
  // through which picking a theme could ever rewrite them.
  const contract = JSON.stringify(THEME_CSS_VARS);
  assert.ok(!/emerald/.test(contract), 'the theme never owns the success colour');
  assert.ok(!/--unity-accent-(amber|red)/.test(contract), 'the theme never owns warning/error');
  for (const preset of THEME_PRESETS) {
    const theme = resolveTheme({ presetId: preset.id });
    assert.ok(!Object.hasOwn(theme.accent, 'emerald'), `${preset.id}: does not theme a status colour`);
  }
});

// ===========================================================================
// One-picker → custom details
// ===========================================================================

test('editing any individual value seeds a custom theme from the preset on screen', () => {
  // This is what keeps "presets + Details" coherent: the first touch of a
  // slider continues from the theme that was showing, instead of jumping to the
  // defaults and losing the user's place.
  const preset = THEME_PRESETS.find((p) => p.id === 'orchid');
  const before = resolveTheme({ presetId: 'orchid' });

  const custom = seedCustomTheme({ presetId: 'orchid' }, { surfaceHue: 200 });
  assert.equal(custom.presetId, CUSTOM_PRESET_ID);
  assert.equal(custom.accent, before.accent.accentBright, 'accent seeded from the preset');
  assert.equal(custom.harmony, preset.harmony, 'harmony seeded from the preset');
  assert.equal(custom.surfaceSaturation, preset.surface.saturation, 'saturation seeded');
  assert.equal(custom.surfaceDepth, preset.surface.depth, 'depth seeded');
  assert.equal(custom.surfaceHue, 200, 'the edit is applied on top of the seed');

  // Seeding is idempotent: dragging a slider must not re-seed every frame.
  const again = seedCustomTheme(custom, { surfaceHue: 210 });
  assert.equal(again.surfaceHue, 210);
  assert.equal(again.surfaceSaturation, preset.surface.saturation);
  assert.equal(again.accent, before.accent.accentBright);

  // A pinned-accent preset keeps its exact colour when it becomes custom.
  const unity = seedCustomTheme({ presetId: 'unity' }, { accent: undefined });
  assert.equal(unity.accent, '#38bdf8');
});

test('a custom accent is kept exactly and still derives a full ramp', () => {
  const palette = resolveThemePalette({ presetId: CUSTOM_PRESET_ID, accent: '#ff6b00', harmony: 'triadic' });
  assert.equal(palette.accentBright, '#ff6b00', 'the picked colour is used verbatim');
  assert.equal(palette.accentRgb, '255, 107, 0');
  assert.notEqual(palette.accentStrong, palette.accentBright);
  assert.notEqual(palette.accentMuted, palette.accentBright);
  assert.equal(hexToHsl(palette.secondary).hue, (hexToHsl('#ff6b00').hue + 120) % 360);
  assert.equal(resolveThemeHarmony({ presetId: CUSTOM_PRESET_ID, accent: '#ff6b00', harmony: 'triadic' }), 'triadic');
});

test('the secondary accent follows the preset harmony rule', () => {
  for (const preset of THEME_PRESETS) {
    const palette = resolveThemePalette({ presetId: preset.id });
    const rule = HARMONY_RULES[preset.harmony];
    const expected = (preset.hue + rule.offset) % 360;
    const actual = hexToHsl(palette.secondary).hue;
    // +-2deg: an HSL round trip through 8-bit hex is not exact.
    const delta = Math.min(Math.abs(actual - expected), 360 - Math.abs(actual - expected));
    assert.ok(delta <= 2, `${preset.id}: secondary hue ${actual} ~= ${expected} (${rule.label})`);
  }

  const rose = THEME_PRESETS.find((p) => p.harmony === 'complementary');
  const partner = hexToHsl(resolveThemePalette({ presetId: rose.id }).secondary).hue;
  assert.equal(partner, (rose.hue + 180) % 360, 'a complementary partner is derived opposite');
  assert.equal((partner - rose.hue + 360) % 360, 180, '...half a turn away, wrap included');

  // Monochromatic means the partner is the SAME hue, not a small offset.
  const mono = resolveThemePalette({ presetId: 'mono' });
  assert.equal(hexToHsl(mono.secondary).hue, hexToHsl(mono.accentBright).hue);
});

// ===========================================================================
// Background / text derivation
// ===========================================================================

test('the surface ramp keeps its ordering, honours depth, and never touches the text', () => {
  const roles = Object.keys(SURFACE_ROLE_LIGHTNESS);
  const ordered = ['darkest', 'dark', 'panel', 'subtle', 'hover'];
  for (let i = 1; i < ordered.length; i += 1) {
    assert.ok(
      SURFACE_ROLE_LIGHTNESS[ordered[i]] > SURFACE_ROLE_LIGHTNESS[ordered[i - 1]],
      'the shipped role lightnesses ascend'
    );
  }

  const deep = buildSurfacePalette({ hue: 220, saturation: 20, depth: SURFACE_LIMITS.minDepth });
  const lifted = buildSurfacePalette({ hue: 220, saturation: 20, depth: SURFACE_LIMITS.maxDepth });
  for (const role of roles.slice(0, 7)) {
    assert.ok(
      hexToHsl(deep[role]).lightness < hexToHsl(lifted[role]).lightness,
      `${role} scales with depth`
    );
  }

  // Depth is a SURFACE control. Text is light-on-dark, so a darker chassis can
  // only increase its contrast — scaling it too is how a depth slider makes an
  // app unreadable, so it is pinned.
  assert.equal(deep.text, lifted.text, 'text does not move with depth');
  assert.equal(deep.textMuted, lifted.textMuted);
  assert.equal(deep.textDim, lifted.textDim);
  // With no tint the derived text is the shipped grey exactly, whatever the depth.
  for (const depth of [SURFACE_LIMITS.minDepth, 1, SURFACE_LIMITS.maxDepth]) {
    assert.equal(
      buildSurfacePalette({ hue: 220, saturation: 0, depth }).text,
      hslToHex(220, 0, TEXT_ROLE_LIGHTNESS.text),
      'the derived text keeps the shipped lightness'
    );
  }
  assert.ok(contrastRatio(deep.text, deep.panel) > 4.5, 'darker panels are easier, not harder, to read');
});

test('a pinned text colour is used exactly, and its muted roles keep the shipped ratios', () => {
  // #d2d2d2 is the shipped body colour, so at the shipped ratios the derived
  // index.css palette (muted #999999, dim #6e6e6e) must come back out.
  const shipped = buildTextPalette({ hex: '#d2d2d2' });
  assert.equal(shipped.text, '#d2d2d2');
  assert.equal(shipped.textMuted, '#999999');
  assert.equal(shipped.textDim, '#6e6e6e');

  const picked = buildSurfacePalette({ textColor: '#ffcc00' });
  assert.equal(picked.text, '#ffcc00', 'the picked colour is the body colour verbatim');
  assert.notEqual(picked.textMuted, picked.text, 'the ramp still has three distinct roles');
  assert.ok(
    hexToHsl(picked.text).lightness > hexToHsl(picked.textMuted).lightness,
    'muted sits below the primary'
  );
  assert.equal(TEXT_LIGHTNESS_RATIOS.textMuted, 0.728);
  assert.equal(TEXT_LIGHTNESS_RATIOS.textDim, 0.523);

  // An empty/invalid pin means "derive from the tint", not "fall back to grey".
  assert.notEqual(buildSurfacePalette({ hue: 20, saturation: 30, textColor: '' }).text, picked.text);
  assert.notEqual(buildSurfacePalette({ hue: 20, saturation: 30, textColor: 'nope' }).text, picked.text);
});

test('contrastRatio measures what the text warning needs', () => {
  assert.equal(contrastRatio('#ffffff', '#000000'), 21);
  assert.equal(contrastRatio('#282828', '#282828'), 1);
  // Black on white and white on black are symmetric.
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);

  const shipped = contrastRatio(SHIPPED_SURFACE.text, SHIPPED_SURFACE.panel);
  assert.ok(shipped > 9 && shipped < 10.5, `shipped body text sits around 9.75:1 (got ${shipped})`);

  // A deliberately bad pairing is what the tab warns about.
  assert.ok(contrastRatio('#3a3a3a', '#282828') < 4.5);
});

// ===========================================================================
// Typography
// ===========================================================================

test('fonts resolve to real stacks, and an unknown id cannot leave the app fontless', () => {
  assert.equal(resolveTypography(THEME_DEFAULTS).fontSans, DEFAULT_FONT_SANS);
  assert.equal(resolveTypography(THEME_DEFAULTS).fontMono, DEFAULT_FONT_MONO);

  for (const font of [...UI_FONT_PRESETS, ...MONO_FONT_PRESETS]) {
    // Every option ends in a generic family, so a machine without the first
    // choice still renders something sane.
    assert.match(font.stack, /(sans-serif|serif|monospace)$/, `${font.id} has a generic fallback`);
    assert.ok(font.label && font.label.length > 1, `${font.id} is named`);
  }

  const georgia = resolveTypography({ fontId: 'georgia', monoFontId: 'consolas' });
  assert.match(georgia.fontSans, /^Georgia/);
  assert.match(georgia.fontMono, /^Consolas/);

  const fallback = resolveTypography({ fontId: 'deleted-font', monoFontId: 42 });
  assert.equal(fallback.fontSans, DEFAULT_FONT_SANS);
  assert.equal(fallback.fontMono, DEFAULT_FONT_MONO);
});

// ===========================================================================
// Clips and waveform
// ===========================================================================

test('the clip palette modes produce the shipped set, a rotation, or per-category colours', () => {
  const shipped = resolveClipPalette(THEME_DEFAULTS);
  for (const category of CLIP_CATEGORIES) {
    assert.equal(shipped[category].accent, CLIP_DEFAULT_COLORS[category].accent, `${category} unchanged`);
  }
  assert.notEqual(shipped, CLIP_DEFAULT_COLORS);
  assert.notEqual(shipped.video, CLIP_DEFAULT_COLORS.video, 'a fresh object, not the frozen constant');

  // "From accent" rotates the shipped relationships with the theme accent, so
  // a different theme really does move the cards...
  const orchidRotated = resolveClipPalette({ presetId: 'orchid', clipPalette: 'accent' });
  const unityRotated = resolveClipPalette({ presetId: 'unity', clipPalette: 'accent' });
  assert.notEqual(orchidRotated.video.accent, unityRotated.video.accent);
  // ...and they stay mutually distinct rather than collapsing onto one hue.
  assert.equal(new Set(CLIP_CATEGORIES.map((c) => orchidRotated[c].accent)).size, CLIP_CATEGORIES.length);
  for (const category of CLIP_CATEGORIES) {
    const expected =
      (hexToHsl(resolveThemePalette({ presetId: 'orchid' }).accentBright).hue + CLIP_ACCENT_HUE_OFFSETS[category]) % 360;
    const actual = hexToHsl(orchidRotated[category].accent).hue;
    const delta = Math.min(Math.abs(actual - expected), 360 - Math.abs(actual - expected));
    assert.ok(delta <= 2, `${category}: rotated by the shipped offset (${actual} ~= ${expected})`);
  }

  // Custom: a category left at its shipped colour keeps its shipped card
  // background, so changing one does not restyle the other four.
  const custom = resolveClipPalette({
    clipPalette: 'custom',
    clipColors: { ...CLIP_DEFAULT_COLORS, audio: '#00ff00' },
  });
  assert.equal(custom.audio.accent, '#00ff00');
  assert.equal(custom.video.background, CLIP_DEFAULT_COLORS.video.background);
  assert.notEqual(custom.audio.background, CLIP_DEFAULT_COLORS.audio.background, 'the background follows the new accent');
  assert.notEqual(custom.video.accent, custom.audio.accent);

  // buildClipColors always produces a dark, low-chroma card behind a bright stripe.
  const derived = buildClipColors('#f59e0b');
  assert.equal(derived.accent, '#f59e0b');
  assert.ok(hexToHsl(derived.background).lightness < hexToHsl(derived.accent).lightness);
  assert.equal(CLIP_PALETTE_MODES.length, 3);
});

test('the waveform follows its mode, and every painter gets an rgba string', () => {
  assert.equal(resolveWaveformHex(THEME_DEFAULTS), WAVEFORM_SHIPPED_COLOR);

  const accentMode = { presetId: 'ember', waveformMode: 'accent' };
  assert.equal(resolveWaveformHex(accentMode), resolveThemePalette(accentMode).accentBright);

  const clipMode = { presetId: 'unity', clipPalette: 'category', waveformMode: 'clip' };
  assert.equal(resolveWaveformHex(clipMode, 'audio'), CLIP_DEFAULT_COLORS.audio.accent);
  assert.equal(resolveWaveformHex(clipMode, 'text'), CLIP_DEFAULT_COLORS.text.accent);

  assert.equal(resolveWaveformHex({ waveformMode: 'custom', waveformColor: '#ff0000' }), '#ff0000');
  assert.equal(resolveWaveformColor({ waveformMode: 'custom', waveformColor: '#ff0000' }), 'rgba(255, 0, 0, 0.55)');
  assert.equal(WAVEFORM_ALPHA, 0.55);
  // An unknown mode cannot leave a painter colourless.
  assert.equal(resolveWaveformHex({ waveformMode: 'nope' }), WAVEFORM_SHIPPED_COLOR);
  assert.equal(WAVEFORM_MODES.length, 4);
});

test('resolveTheme returns the whole theme in one object', () => {
  const theme = resolveTheme({ presetId: 'orchid', clipPalette: 'accent', waveformMode: 'clip' });
  assert.ok(theme.settings && theme.accent && theme.surface && theme.typography && theme.clips && theme.waveform);
  assert.equal(theme.settings.presetId, 'orchid');
  assert.equal(Object.keys(theme.clips).length, CLIP_CATEGORIES.length);
  // The rgb channels are derived from the same hex the colour came from, which
  // is what lets CSS and the canvas agree on one waveform colour.
  assert.equal(hexToRgbChannels(`#${theme.waveform.hex.slice(1)}`), theme.waveform.rgb);
});

// ===========================================================================
// Sanitizing / persistence / application
// ===========================================================================

test('the sanitizer turns anything into a complete, usable theme', () => {
  const fallback = sanitizeThemeSettings(undefined);
  assert.deepEqual(fallback, sanitizeThemeSettings(THEME_DEFAULTS));

  const junk = sanitizeThemeSettings({
    presetId: 'deleted-theme',
    accent: 'not-a-colour',
    harmony: 'nope',
    surfaceHue: 999,
    surfaceSaturation: 500,
    surfaceDepth: -3,
    textColor: 'nonsense',
    fontId: 'deleted-font',
    monoFontId: 'deleted-font',
    clipPalette: 'nope',
    clipColors: { video: '#zzzzzz' },
    waveformMode: 'nope',
    waveformColor: 'nope',
  });
  assert.equal(junk.presetId, THEME_DEFAULTS.presetId);
  assert.equal(junk.accent, THEME_DEFAULTS.accent);
  assert.equal(junk.harmony, THEME_DEFAULTS.harmony);
  assert.ok(junk.surfaceHue >= 0 && junk.surfaceHue < 360, 'hue wrapped into range');
  assert.equal(junk.surfaceSaturation, SURFACE_LIMITS.maxSaturation);
  assert.equal(junk.surfaceDepth, SURFACE_LIMITS.minDepth);
  assert.equal(junk.textColor, '', "'unset' survives as unset, so it stays derived");
  assert.equal(junk.fontId, THEME_DEFAULTS.fontId);
  assert.equal(junk.monoFontId, THEME_DEFAULTS.monoFontId);
  assert.equal(junk.clipPalette, THEME_DEFAULTS.clipPalette);
  assert.equal(junk.clipColors.video, CLIP_DEFAULT_COLORS.video.accent, 'each category filled in');
  assert.equal(junk.waveformMode, THEME_DEFAULTS.waveformMode);
  assert.equal(junk.waveformColor, WAVEFORM_SHIPPED_COLOR);

  // Valid values are preserved, and accents are lower-cased so a picker value
  // and a stored one compare equal.
  const kept = sanitizeThemeSettings({ presetId: 'rose', accent: '#FF6B00', textColor: '#ABCDEF' });
  assert.equal(kept.presetId, 'rose');
  assert.equal(kept.accent, '#ff6b00');
  assert.equal(kept.textColor, '#abcdef');
  assert.equal(CUSTOM_PRESET_ID, 'custom');
});

test('settings round-trip through storage, and a corrupt store cannot brick the app', () => {
  withFakeStorage(() => {
    assert.equal(loadThemeSettings().presetId, THEME_DEFAULTS.presetId, 'empty storage → defaults');

    const saved = saveThemeSettings({
      presetId: 'forest',
      clipPalette: 'accent',
      waveformMode: 'custom',
      waveformColor: '#00ffcc',
      fontId: 'georgia',
      textColor: '#ffcc00',
    });
    assert.deepEqual(loadThemeSettings(), saved);

    globalThis.localStorage.setItem('blahblah.themeSettings.v1', '{not json');
    assert.equal(loadThemeSettings().presetId, THEME_DEFAULTS.presetId, 'garbage → defaults');
  });
});

test('applyTheme writes every owned variable, and clearing restores the stylesheet defaults', () => {
  const root = fakeRoot();
  const theme = resolveTheme({ presetId: 'violet', clipPalette: 'accent', waveformMode: 'accent', fontId: 'roboto' });
  applyTheme(theme, root);

  for (const group of ['accent', 'surface', 'typography', 'waveform']) {
    for (const [role, cssVar] of Object.entries(THEME_CSS_VARS[group])) {
      assert.equal(root.props[cssVar], theme[group][role], `${cssVar} written`);
    }
  }
  for (const category of CLIP_CATEGORIES) {
    assert.equal(root.props[CLIP_CSS_VARS[category].background], theme.clips[category].background);
    assert.equal(root.props[CLIP_CSS_VARS[category].accent], theme.clips[category].accent);
  }

  const applied = applyThemeSettings({ presetId: 'violet', clipPalette: 'accent' }, root);
  assert.equal(root.dataset.theme, 'violet/accent', 'the theme is stamped for stylesheets');

  clearAppliedTheme(root);
  assert.deepEqual(root.props, {}, 'no inline overrides left');
  assert.equal(root.dataset.theme, undefined);

  // A custom theme tags itself as custom, with its harmony rule for debugging.
  applyThemeSettings({ presetId: CUSTOM_PRESET_ID, accent: '#ff6b00', harmony: 'triadic' }, root);
  assert.equal(root.dataset.theme, 'custom:triadic/category');
  assert.equal(root.props[THEME_CSS_VARS.accent.accentBright], '#ff6b00');

  // No DOM (tests, SSR) is a no-op, not a crash.
  assert.doesNotThrow(() => applyTheme(theme, null));
  assert.ok(applied.accent.accentBright);
  assert.equal(readCssValue('--unity-accent-blue', '#38bdf8'), '#38bdf8');
});

test('the live theme cache stays in sync and subscribers are cheap', () => {
  withFakeStorage(() => {
    // No window in node: subscribing must still hand back a working unsubscribe.
    const seen = [];
    const unsubscribe = subscribeThemeChanges((next) => seen.push(next.presetId));
    assert.equal(typeof unsubscribe, 'function');

    notifyThemeChanged({ presetId: 'midnight', waveformMode: 'accent' }, null);
    assert.equal(getLiveThemeSettings().presetId, 'midnight');
    assert.equal(getLiveThemeSettings().waveformMode, 'accent');

    // Nonsense broadcast in, safe defaults out.
    notifyThemeChanged({ presetId: 'nope' }, null);
    assert.equal(getLiveThemeSettings().presetId, THEME_DEFAULTS.presetId);

    unsubscribe();
  });
});

// ===========================================================================
// Colour maths
// ===========================================================================

test('colour conversion helpers agree with the CSS values they replace', () => {
  // hsl(198, 93%, 60%) is the shipped accent's hue and saturation at the ramp's
  // shared lightness; the Unity theme pins the 2/255 difference (see
  // THEME_PRESETS) because #38bdf8's real lightness is 59.6%.
  assert.equal(hslToHex(198, 93, 60), '#3abff8');
  assert.deepEqual(hexToHsl('#38bdf8'), { hue: 198, saturation: 93, lightness: 60 });
  assert.equal(hexToRgbChannels('#38bdf8'), '56, 189, 248');
  assert.equal(hexToRgba('#38bdf8', 0.5), 'rgba(56, 189, 248, 0.5)');
  // The shipped greys are exact at 0% saturation, which is what makes the
  // default chassis reproducible.
  assert.equal(hslToHex(0, 0, 9.8), '#191919');
  assert.equal(hslToHex(220, 0, 15.7), '#282828');
  assert.equal(hslToHex(220, 0, TEXT_ROLE_LIGHTNESS.text), '#d2d2d2');
  // Hue wraps in both directions.
  assert.equal(hslToHex(-30, 100, 50), hslToHex(330, 100, 50));
  assert.equal(hslToHex(390, 100, 50), hslToHex(30, 100, 50));
  // Invalid colours fall back instead of throwing or producing NaN channels.
  assert.equal(hexToRgba('not-a-colour', 1, '#000000'), 'rgba(0, 0, 0, 1)');
  assert.equal(hexToHsl('nope', '#000000').lightness, 0);

  assert.ok(isValidHexColor('#000000'));
  assert.ok(!isValidHexColor('#abc'));
  assert.ok(!isValidHexColor('rgba(0, 0, 0, 1)'));
  assert.ok(!isValidHexColor(undefined));

  // Unknown ids cannot leave a resolver without a theme.
  assert.ok(getThemePreset('unity'));
  assert.ok(resolveThemePalette({ presetId: 'deleted-preset' }).accentBright);
  assert.ok(buildThemePalette().accentBright, 'a bare call still derives something');
  assert.ok(resolveSurfacePalette({ presetId: 'deleted-preset' }).panel);
});
