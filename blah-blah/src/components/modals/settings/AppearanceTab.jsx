import { useMemo, useState } from 'react';
import { Check, RotateCcw, SlidersHorizontal, ChevronDown } from 'lucide-react';
import {
  CLIP_CATEGORIES,
  CLIP_DEFAULT_COLORS,
  CUSTOM_PRESET_ID,
  HARMONY_RULES,
  MONO_FONT_PRESETS,
  SURFACE_LIMITS,
  THEME_DEFAULTS,
  THEME_PRESETS,
  UI_FONT_PRESETS,
  WAVEFORM_MODES,
  contrastRatio,
  hexToHsl,
  hexToRgba,
  hslToHex,
  isValidHexColor,
  resolveTheme,
  resolveThemeHarmony,
  resolveWaveformHex,
  seedCustomTheme,
} from '../../../services/themeSettings';

/** Friendly names for the clip categories, for the custom colour pickers. */
const CATEGORY_LABELS = {
  video: 'Video',
  audio: 'Audio',
  text: 'Text',
  shape: 'Shape',
  prefab: 'Prefab',
};

const WAVEFORM_MODE_LABELS = {
  shipped: 'Default violet',
  accent: 'Theme accent',
  clip: 'Clip colour',
  custom: 'Custom',
};

const CLIP_MODE_LABELS = {
  category: 'By category',
  accent: 'From accent',
  custom: 'Custom',
};

/** Below this WCAG ratio, body text on the panel is genuinely hard to read. */
const MIN_TEXT_CONTRAST = 4.5;

/** A seven-bar waveform glyph, drawn in whatever colour it is given. */
function WaveformGlyph({ color, className }) {
  const bars = [0.35, 0.7, 1, 0.55, 0.85, 0.4, 0.65];
  return (
    <span className={className} aria-hidden="true">
      {bars.map((scale, index) => (
        <span key={index} style={{ height: `${Math.round(scale * 100)}%`, background: color }} />
      ))}
    </span>
  );
}

/**
 * Appearance tab — the whole theme (services/themeSettings.js).
 *
 * THE SHAPE OF THIS TAB, AND WHY
 *   A theme is picked as ONE thing: each card in the grid sets the accent AND
 *   the background chassis together, so there is no way to end up with an
 *   accent that fights its own panels. The card swatch is the preset's real
 *   resolved palette (accent bar, panel, text), not a decorative colour.
 *
 *   Everything below the grid lives in "Details", which opens up the individual
 *   values (accent hue/saturation, background tint/depth, text colour, fonts,
 *   clip colours, waveform). Touching any of them calls seedCustomTheme(), so
 *   the theme becomes `custom` STARTING FROM the preset that was on screen —
 *   the first tweak continues from where you were instead of jumping to the
 *   defaults.
 *
 *   Appearance is global (localStorage) and applied live: every control
 *   rewrites CSS custom properties on <html> through App, so the editor
 *   re-colours on the next render. There is nothing to "apply".
 *
 * Props:
 *   settings  the stored theme (see THEME_DEFAULTS)
 *   onChange  (next) => void — updater owned by App
 */
export function AppearanceTab({ settings, onChange }) {
  const current = settings || THEME_DEFAULTS;
  const theme = useMemo(() => resolveTheme(current), [current]);
  const palette = theme.accent;
  const surface = theme.surface;
  const harmony = HARMONY_RULES[resolveThemeHarmony(current)];
  const isCustom = current.presetId === CUSTOM_PRESET_ID;

  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  // The hex field is free text, so half-typed values ("#38" on the way to
  // "#38bdf8") must not be written into settings. The draft is only non-null
  // WHILE the field is focused, so there is no state to resynchronise when a
  // preset or the colour picker changes the accent.
  const [hexDraft, setHexDraft] = useState(null);

  const waveformHex = resolveWaveformHex(current);
  const waveformColor = hexToRgba(waveformHex, 1);
  const textContrast = contrastRatio(surface.text, surface.panel);

  // Pre-resolved swatches: the preset list never changes at runtime, so each
  // card's full palette is computed once.
  const cards = useMemo(
    () => THEME_PRESETS.map((preset) => ({
      preset,
      theme: resolveTheme({ presetId: preset.id }),
      theory: HARMONY_RULES[preset.harmony].label,
    })),
    []
  );

  const update = (patch) => onChange?.({ ...current, ...patch });
  /** Any individual-value edit turns the preset into a custom theme. */
  const updateDetail = (patch) => onChange?.(seedCustomTheme(current, patch));

  const accentHsl = hexToHsl(current.accent);
  const surfaceHue = isCustom ? current.surfaceHue : (THEME_PRESETS.find((p) => p.id === current.presetId) || THEME_PRESETS[0]).surface.hue;
  const surfaceSaturation = isCustom
    ? current.surfaceSaturation
    : (THEME_PRESETS.find((p) => p.id === current.presetId) || THEME_PRESETS[0]).surface.saturation;
  const surfaceDepth = isCustom
    ? current.surfaceDepth
    : (THEME_PRESETS.find((p) => p.id === current.presetId) || THEME_PRESETS[0]).surface.depth;

  const commitAccent = (value) => {
    const candidate = value.startsWith('#') ? value : `#${value}`;
    if (!isValidHexColor(candidate)) return;
    updateDetail({ accent: candidate.toLowerCase() });
  };

  /**
   * The hue/saturation sliders keep the accent's current lightness and write
   * back a hex, so the colour picker, the hex field and the sliders can never
   * disagree about what the accent is.
   */
  const handleAccentHue = (hue) => updateDetail({ accent: hslToHex(hue, accentHsl.saturation, accentHsl.lightness) });
  const handleAccentSaturation = (saturation) =>
    updateDetail({ accent: hslToHex(accentHsl.hue, saturation, accentHsl.lightness) });

  const isDefault =
    current.presetId === THEME_DEFAULTS.presetId &&
    current.clipPalette === THEME_DEFAULTS.clipPalette &&
    current.waveformMode === THEME_DEFAULTS.waveformMode &&
    current.fontId === THEME_DEFAULTS.fontId &&
    current.monoFontId === THEME_DEFAULTS.monoFontId &&
    !current.textColor;

  const accentRoles = [
    { label: 'Accent', value: palette.accentBright, note: 'selection, focus, active tab' },
    { label: 'Hover', value: palette.accentStrong, note: 'pressed / hover shade' },
    { label: 'Deep', value: palette.accentMuted, note: 'filled buttons' },
    { label: 'Soft', value: palette.accentSoft, note: 'light tint on dark panels' },
    { label: `Secondary (${harmony.label})`, value: palette.secondary, note: 'gradients, harmony partner' },
  ];

  return (
    <div className="modal-body settings-body">
      {/* ================= The theme ================= */}
      <div className="form-field-group">
        <label className="form-label">Theme</label>
        <p className="hint-text-sm settings-hint-below">
          One pick sets both the accent (selection, focus rings, playhead) and the background chassis
          (every panel, lane, border and text colour), so the two can never clash. Each card is a base
          hue plus a colour-theory harmony rule, which is what derives its partner colour.
        </p>

        <div className="theme-preset-grid" role="radiogroup" aria-label="Theme presets">
          {cards.map(({ preset, theme: cardTheme, theory }) => {
            const isActive = current.presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                aria-label={`${preset.label} (${theory})`}
                className={`theme-preset-card ${isActive ? 'active' : ''}`}
                title={preset.blurb}
                // Picking a preset clears a pinned text colour, so the preset
                // fully decides the look; everything else in Details (fonts,
                // clips, waveform) is kept.
                onClick={() => update({ presetId: preset.id, textColor: '' })}
              >
                <span className="theme-preset-swatch" style={{ background: cardTheme.surface.panel }}>
                  <span className="theme-swatch-accent" style={{ background: cardTheme.accent.accentBright }}>
                    {isActive && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="theme-swatch-text" style={{ background: cardTheme.surface.text }} />
                  <span className="theme-swatch-secondary" style={{ background: cardTheme.accent.secondary }} />
                </span>
                <span className="theme-preset-name">{preset.label}</span>
                <span className="theme-preset-theory">{theory}</span>
              </button>
            );
          })}
        </div>

        <p className="hint-text-sm settings-hint-spaced">
          <strong>{isCustom ? 'Custom theme' : (THEME_PRESETS.find((p) => p.id === current.presetId) || THEME_PRESETS[0]).label}</strong>
          {' — '}
          {isCustom
            ? 'built from the values in Details below.'
            : (THEME_PRESETS.find((p) => p.id === current.presetId) || THEME_PRESETS[0]).blurb}
        </p>
      </div>

      {/* ================= Details ================= */}
      <div className="form-field-group settings-group-spaced">
        <button
          type="button"
          className={`theme-details-toggle ${isDetailsOpen ? 'open' : ''}`}
          onClick={() => setIsDetailsOpen((open) => !open)}
          aria-expanded={isDetailsOpen}
        >
          <SlidersHorizontal size={13} />
          <span>Details</span>
          <span className="theme-details-summary">
            accent · background · text · fonts · clips · waveform
          </span>
          <ChevronDown size={14} className="theme-details-chevron" />
        </button>

        {isDetailsOpen && (
          <div className="theme-details-body">
            {/* ---- Accent ---- */}
            <div className="theme-detail-group">
              <div className="theme-detail-heading">
                Accent
                {isCustom && <span className="theme-detail-badge">custom</span>}
              </div>

              <div className="theme-slider-grid">
                <label className="theme-slider-row">
                  <span>Hue</span>
                  <input
                    type="range"
                    min={0}
                    max={359}
                    step={1}
                    value={accentHsl.hue}
                    aria-label="Accent hue"
                    onChange={(e) => handleAccentHue(Number(e.target.value))}
                  />
                  <code>{accentHsl.hue}°</code>
                </label>
                <label className="theme-slider-row">
                  <span>Saturation</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={accentHsl.saturation}
                    aria-label="Accent saturation"
                    onChange={(e) => handleAccentSaturation(Number(e.target.value))}
                  />
                  <code>{accentHsl.saturation}%</code>
                </label>
              </div>

              <div className="theme-custom-row settings-hint-spaced">
                <input
                  type="color"
                  className="theme-color-input"
                  aria-label="Accent colour"
                  value={current.accent}
                  onChange={(e) => updateDetail({ accent: e.target.value })}
                />
                <input
                  type="text"
                  className="modal-text-input theme-hex-input"
                  aria-label="Accent hex value"
                  spellCheck={false}
                  value={hexDraft ?? current.accent}
                  onFocus={() => setHexDraft(current.accent)}
                  onChange={(e) => {
                    setHexDraft(e.target.value);
                    commitAccent(e.target.value);
                  }}
                  onBlur={() => setHexDraft(null)}
                />
                <select
                  className="modal-text-input settings-select theme-harmony-select"
                  aria-label="Colour harmony rule"
                  value={current.harmony}
                  onChange={(e) => updateDetail({ harmony: e.target.value })}
                >
                  {Object.entries(HARMONY_RULES).map(([id, rule]) => (
                    <option key={id} value={id}>
                      {rule.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="hint-text-sm settings-hint-spaced">
                <strong>{harmony.label}</strong> — {harmony.note}
              </p>
            </div>

            {/* ---- Background ---- */}
            <div className="theme-detail-group">
              <div className="theme-detail-heading">Background</div>
              <div className="theme-slider-grid">
                <label className="theme-slider-row">
                  <span>Tint</span>
                  <input
                    type="range"
                    min={0}
                    max={359}
                    step={1}
                    value={surfaceHue}
                    aria-label="Background tint"
                    onChange={(e) => updateDetail({ surfaceHue: Number(e.target.value) })}
                  />
                  <code>{surfaceHue}°</code>
                </label>
                <label className="theme-slider-row">
                  <span>Saturation</span>
                  <input
                    type="range"
                    min={SURFACE_LIMITS.minSaturation}
                    max={SURFACE_LIMITS.maxSaturation}
                    step={1}
                    value={surfaceSaturation}
                    aria-label="Background saturation"
                    onChange={(e) => updateDetail({ surfaceSaturation: Number(e.target.value) })}
                  />
                  <code>{surfaceSaturation}</code>
                </label>
                <label className="theme-slider-row">
                  <span>Depth</span>
                  <input
                    type="range"
                    min={SURFACE_LIMITS.minDepth}
                    max={SURFACE_LIMITS.maxDepth}
                    step={0.05}
                    value={surfaceDepth}
                    aria-label="Background depth"
                    onChange={(e) => updateDetail({ surfaceDepth: Number(e.target.value) })}
                  />
                  <code>×{surfaceDepth}</code>
                </label>
              </div>
              <p className="hint-text-sm settings-hint-spaced">
                Depth scales the greys — below 1 is darker, above 1 lifts them. The contrast between a
                panel and its text stays fixed whatever you pick, so nothing becomes unreadable.
              </p>
            </div>

            {/* ---- Text ---- */}
            <div className="theme-detail-group">
              <div className="theme-detail-heading">
                Text
                {current.textColor && <span className="theme-detail-badge">pinned</span>}
              </div>

              <div className="theme-custom-row">
                <input
                  type="color"
                  className="theme-color-input"
                  aria-label="Text colour"
                  value={current.textColor || surface.text}
                  onChange={(e) => updateDetail({ textColor: e.target.value })}
                />
                <code className="theme-hex-readout">{surface.text}</code>
                <button
                  type="button"
                  className="btn-secondary btn-xs"
                  disabled={!current.textColor}
                  onClick={() => updateDetail({ textColor: '' })}
                >
                  Use background tint
                </button>
              </div>

              {textContrast < MIN_TEXT_CONTRAST && (
                <p className="theme-contrast-warning">
                  Contrast with the panel is only {textContrast.toFixed(1)}:1. Below {MIN_TEXT_CONTRAST}:1
                  body text is hard to read — try a lighter colour.
                </p>
              )}

              <div className="theme-font-row settings-hint-spaced">
                <label className="theme-font-field">
                  <span>Interface font</span>
                  <select
                    className="modal-text-input settings-select"
                    value={current.fontId}
                    // Typography is independent of the colour theme, so this
                    // does NOT switch the theme to custom.
                    onChange={(e) => update({ fontId: e.target.value })}
                  >
                    {UI_FONT_PRESETS.map((font) => (
                      <option key={font.id} value={font.id}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="theme-font-field">
                  <span>Monospace font</span>
                  <select
                    className="modal-text-input settings-select"
                    value={current.monoFontId}
                    onChange={(e) => update({ monoFontId: e.target.value })}
                  >
                    {MONO_FONT_PRESETS.map((font) => (
                      <option key={font.id} value={font.id}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="theme-font-sample" style={{ fontFamily: theme.typography.fontSans }}>
                Interface sample — 0123456789{' '}
                <code style={{ fontFamily: theme.typography.fontMono }}>mono sample</code>
              </p>
            </div>

            {/* ---- Clip colours ---- */}
            <div className="theme-detail-group">
              <div className="theme-detail-heading">Clip colours</div>
              <p className="hint-text-sm settings-hint-below">
                “From accent” rotates the shipped category relationships with the theme accent, keeping
                audio a fourth-turn from video, text the warm one and shape the green.
              </p>

              <div className="theme-mode-row" role="radiogroup" aria-label="Clip colour palette">
                {Object.keys(CLIP_MODE_LABELS).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={current.clipPalette === mode}
                    className={`theme-mode-btn ${current.clipPalette === mode ? 'active' : ''}`}
                    onClick={() => update({ clipPalette: mode })}
                  >
                    {CLIP_MODE_LABELS[mode]}
                  </button>
                ))}
              </div>

              <div className="theme-clip-preview settings-hint-spaced">
                {CLIP_CATEGORIES.map((category) => (
                  <span
                    key={category}
                    className="theme-clip-chip"
                    style={{
                      background: theme.clips[category].background,
                      borderLeftColor: theme.clips[category].accent,
                    }}
                    title={`${CATEGORY_LABELS[category]}: ${theme.clips[category].accent}`}
                  >
                    {CATEGORY_LABELS[category]}
                  </span>
                ))}
              </div>

              {current.clipPalette === 'custom' && (
                <div className="theme-clip-custom settings-hint-spaced">
                  {CLIP_CATEGORIES.map((category) => (
                    <label className="theme-clip-custom-row" key={category}>
                      <input
                        type="color"
                        className="theme-color-input theme-color-input-sm"
                        aria-label={`${CATEGORY_LABELS[category]} clip accent`}
                        value={current.clipColors[category]}
                        onChange={(e) =>
                          update({ clipPalette: 'custom', clipColors: { ...current.clipColors, [category]: e.target.value } })
                        }
                      />
                      <span>{CATEGORY_LABELS[category]}</span>
                      <code>{current.clipColors[category]}</code>
                      {current.clipColors[category] !== CLIP_DEFAULT_COLORS[category].accent && (
                        <button
                          type="button"
                          className="theme-clip-reset"
                          title={`Back to ${CLIP_DEFAULT_COLORS[category].accent}`}
                          onClick={() =>
                            update({
                              clipColors: { ...current.clipColors, [category]: CLIP_DEFAULT_COLORS[category].accent },
                            })
                          }
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                    </label>
                  ))}
                  <p className="hint-text-sm">
                    A category left at its shipped colour keeps its shipped card background, so changing
                    one category does not restyle the other four.
                  </p>
                </div>
              )}
            </div>

            {/* ---- Waveform ---- */}
            <div className="theme-detail-group">
              <div className="theme-detail-heading">Audio waveform</div>
              <div className="theme-mode-row" role="radiogroup" aria-label="Waveform colour">
                {WAVEFORM_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={current.waveformMode === mode}
                    className={`theme-mode-btn ${current.waveformMode === mode ? 'active' : ''}`}
                    onClick={() => update({ waveformMode: mode })}
                  >
                    {WAVEFORM_MODE_LABELS[mode]}
                  </button>
                ))}
              </div>

              <div className="theme-custom-row settings-hint-spaced">
                <WaveformGlyph color={waveformColor} className="theme-waveform-preview" />
                <input
                  type="color"
                  className="theme-color-input"
                  aria-label="Custom waveform colour"
                  value={waveformHex}
                  onChange={(e) => update({ waveformMode: 'custom', waveformColor: e.target.value })}
                />
                <code className="theme-waveform-hex">{waveformHex}</code>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ================= Derived ramp ================= */}
      <div className="form-field-group settings-group-spaced">
        <label className="form-label">Resolved tokens</label>
        <p className="hint-text-sm settings-hint-below">
          What the theme above actually generates. The editor behind this window is already using it.
        </p>
        <dl className="theme-role-list">
          {accentRoles.map((role) => (
            <div className="theme-role-row" key={role.label}>
              <span className="theme-role-dot" style={{ background: role.value }} aria-hidden="true" />
              <dt>{role.label}</dt>
              <dd>
                <code>{role.value}</code>
                <span className="theme-role-note">{role.note}</span>
              </dd>
            </div>
          ))}
          <div className="theme-role-row">
            <span className="theme-role-dot" style={{ background: surface.panel }} aria-hidden="true" />
            <dt>Panel / Text</dt>
            <dd>
              <code>
                {surface.panel} · {surface.text}
              </code>
              <span className="theme-role-note">{textContrast.toFixed(1)}:1 contrast</span>
            </dd>
          </div>
        </dl>
      </div>

      <button
        type="button"
        className="btn-secondary btn-xs"
        disabled={isDefault}
        onClick={() => update({ ...THEME_DEFAULTS })}
      >
        <RotateCcw size={12} />
        Reset to Defaults
      </button>
    </div>
  );
}
