import { CanvasComponent } from '@blahblah/sdk';

/**
 * Floating code-editor panel with syntax highlighting and a typewriter reveal.
 * Great for TikTok/YouTube game devlog videos showing off a snippet.
 */
export default class CodeSnippet extends CanvasComponent {
  static props = {
    // ── Content ───────────────────────────────────────────────────────────────
    code:           { type: 'textarea', default: 'const velocity = new Vec2(0, 0);\nconst GRAVITY = 9.8;\n\nfunction update(dt) {\n  velocity.y += GRAVITY * dt;\n  player.pos.add(velocity.scale(dt));\n  if (player.pos.y >= FLOOR) land();\n}', label: 'Code', tab: 'Content' },
    language:       { type: 'select',  default: 'javascript', options: ['javascript', 'python', 'rust', 'glsl'], label: 'Language', tab: 'Content', selectButton: true },
    title:          { type: 'string',  default: 'main.js',   label: 'File Name',      tab: 'Content' },
    showTitleBar:   { type: 'boolean', default: true,         label: 'Show Title Bar', tab: 'Content' },
    showLineNumbers:{ type: 'boolean', default: true,         label: 'Line Numbers',   tab: 'Content' },

    // ── Style ─────────────────────────────────────────────────────────────────
    theme:        { type: 'select', default: 'dark', options: ['dark', 'light', 'monokai'], label: 'Theme',        tab: 'Style', box: 'Editor', selectButton: true },
    fontFamily:   { type: 'font',   default: 'JetBrains Mono', label: 'Font',         tab: 'Style', box: 'Typography' },
    fontSize:     { type: 'number', default: 22, min: 10, max: 60,  label: 'Font Size',    tab: 'Style', box: 'Typography', inline: true },
    accentColor:  { type: 'color',  default: '#a78bfa',            label: 'Accent Color', tab: 'Style', box: 'Colors' },
    cornerRadius: { type: 'number', default: 12, min: 0,  max: 40,  label: 'Corner Radius',tab: 'Style', box: 'Panel' },
    panelOpacity: { type: 'number', default: 0.92, min: 0.2, max: 1, step: 0.01, label: 'Panel Opacity', tab: 'Style', box: 'Panel' },
    panelScale:   { type: 'number', default: 1, min: 0.3, max: 2, step: 0.05, label: 'Scale', tab: 'Style', box: 'Panel' },

    // ── Timing ────────────────────────────────────────────────────────────────
    useClipDuration: { type: 'boolean', default: false, label: 'Use Clip Length',        tab: 'Timing', box: 'Typewriter' },
    typeDuration:    { type: 'number',  default: 3, min: 0.1, max: 30, step: 0.1, label: 'Full Type Duration (s)', tab: 'Timing', box: 'Typewriter', showIf: '!useClipDuration' },
    typeDelay:       { type: 'number',  default: 0.2, min: 0, max: 10, step: 0.05, label: 'Start Delay (s)',       tab: 'Timing', box: 'Typewriter' },
    fadeInDuration:  { type: 'number',  default: 0.25, min: 0, max: 2, step: 0.05, label: 'Panel Fade In (s)',     tab: 'Timing', box: 'Entrance' },
    cursorBlink:     { type: 'boolean', default: true,  label: 'Blinking Cursor',         tab: 'Timing', box: 'Cursor' },

    // ── Position ──────────────────────────────────────────────────────────────
    positionX: { type: 'number', default: 0, min: -900, max: 900, label: 'X', tab: 'Position', box: 'Center Offset', inline: true },
    positionY: { type: 'number', default: 0, min: -500, max: 500, label: 'Y', tab: 'Position', box: 'Center Offset', inline: true },
  };

  onUpdate({ time, duration: clipDuration, props }) {
    const { ctx, canvasWidth, canvasHeight } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    this.centerOrigin();

    // ── Theme ─────────────────────────────────────────────────────────────────
    const T = THEMES[props.theme] || THEMES.dark;

    // ── Typewriter progress ───────────────────────────────────────────────────
    const elapsed  = Math.max(0, time - props.typeDelay);
    const duration = props.useClipDuration
      ? Math.max(0.01, clipDuration - props.typeDelay)
      : Math.max(0.01, props.typeDuration);
    const rawProg  = clamp01(elapsed / duration);
    // Ease-out quad: fast start, gentle finish
    const progress = 1 - Math.pow(1 - rawProg, 2);

    const code         = props.code || '';
    const visibleChars = Math.floor(code.length * progress);
    const visibleCode  = code.slice(0, visibleChars);
    const showCursor   = props.cursorBlink && (Math.floor(time * 2) % 2 === 0);

    // ── Layout measurements ───────────────────────────────────────────────────
    const TITLE_H   = props.showTitleBar ? 38 : 0;
    const LINE_H    = props.fontSize * 1.65;
    const PAD_X     = 24;
    const PAD_Y     = 16;
    const LN_COL    = props.showLineNumbers ? 52 : 0; // line-number column width

    const codeFont  = `600 ${props.fontSize}px "${props.fontFamily}", "Courier New", monospace`;
    ctx.font = codeFont;

    // Measure the widest line to size the panel
    const allLines   = code.split('\n');
    const maxLineW   = Math.max(100, ...allLines.map((l) => ctx.measureText(l.replace(/\t/g, '  ')).width));
    const panelW     = Math.min(1100, Math.max(440, maxLineW + LN_COL + PAD_X * 2 + 16));
    const panelH     = allLines.length * LINE_H + TITLE_H + PAD_Y * 2;

    // ── Render ────────────────────────────────────────────────────────────────
    const panelAlpha = clamp01(time / Math.max(0.01, props.fadeInDuration));
    if (panelAlpha <= 0) { this.restoreOrigin(); return; }

    ctx.save();
    ctx.translate(props.positionX, props.positionY);
    ctx.scale(props.panelScale, props.panelScale);
    ctx.globalAlpha = panelAlpha;

    const px = -panelW / 2;
    const py = -panelH / 2;

    // Panel background
    ctx.fillStyle = hexWithAlpha(T.bg, props.panelOpacity);
    ctx.beginPath();
    ctx.roundRect(px, py, panelW, panelH, props.cornerRadius);
    ctx.fill();

    // Thin accent border around panel
    ctx.strokeStyle = hexWithAlpha(props.accentColor, 0.35);
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(px, py, panelW, panelH, props.cornerRadius);
    ctx.stroke();

    // ── Title bar ─────────────────────────────────────────────────────────────
    if (props.showTitleBar) {
      ctx.fillStyle = hexWithAlpha(T.titleBg, props.panelOpacity);
      ctx.beginPath();
      ctx.roundRect(px, py, panelW, TITLE_H, [props.cornerRadius, props.cornerRadius, 0, 0]);
      ctx.fill();

      // Traffic-light dots
      const dots = [{ c: '#ef4444', x: px + 18 }, { c: '#facc15', x: px + 40 }, { c: '#4ade80', x: px + 62 }];
      dots.forEach(({ c, x }) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, py + TITLE_H / 2, 6, 0, Math.PI * 2);
        ctx.fill();
      });

      // File name
      ctx.fillStyle   = props.accentColor;
      ctx.font        = `600 ${props.fontSize * 0.7}px "${props.fontFamily}", sans-serif`;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(props.title, px + panelW / 2, py + TITLE_H / 2);
    }

    // ── Code area: clip so text can't overflow panel ──────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py + TITLE_H, panelW, panelH - TITLE_H);
    ctx.clip();

    ctx.font        = codeFont;
    ctx.textBaseline = 'middle';
    ctx.textAlign   = 'left';

    // Tokenize the FULL code for colors, but only render up to visibleChars
    const tokens = tokenize(code, props.language, props.accentColor, T);
    let charCount = 0;

    // Walk line by line
    let lineIndex = 0;
    for (const line of allLines) {
      if (charCount >= visibleChars && !showCursor) break;

      const lineY   = py + TITLE_H + PAD_Y + lineIndex * LINE_H + LINE_H / 2;
      let   curX    = px + PAD_X + LN_COL;

      // Line number
      if (props.showLineNumbers) {
        ctx.fillStyle  = T.lineNum;
        ctx.textAlign  = 'right';
        ctx.fillText(String(lineIndex + 1), px + PAD_X + LN_COL - 10, lineY);
        ctx.textAlign  = 'left';
      }

      // Render tokens for this line's characters
      const lineEnd = charCount + line.length;

      for (const tok of tokens) {
        // Skip tokens before this line's range
        if (tok.start >= lineEnd + 1) break;  // +1 for the \n
        if (tok.end   <= charCount)   continue;

        // How many chars of this token are on this line and visible?
        const tokStart = Math.max(tok.start, charCount);
        const tokEnd   = Math.min(tok.end, Math.min(lineEnd, visibleChars));
        if (tokStart >= tokEnd) continue;

        const text = tok.text.slice(tokStart - tok.start, tokEnd - tok.start).replace(/\t/g, '  ');
        if (!text) continue;

        ctx.fillStyle = tok.color;
        ctx.fillText(text, curX, lineY);
        curX += ctx.measureText(text).width;
      }

      // Cursor at end of last visible char on this line
      if (showCursor && visibleChars >= charCount && visibleChars <= lineEnd) {
        const beforeCursor = line.slice(0, visibleChars - charCount).replace(/\t/g, '  ');
        const cursorX = px + PAD_X + LN_COL + ctx.measureText(beforeCursor).width;
        ctx.fillStyle = props.accentColor;
        ctx.fillRect(cursorX, lineY - props.fontSize * 0.55, 2.5, props.fontSize * 1.1);
      }

      charCount += line.length + 1; // +1 for the '\n'
      lineIndex++;
    }

    ctx.restore(); // clip restore
    ctx.restore(); // transform restore
    this.restoreOrigin();
  }
}

// ─── Theme definitions ────────────────────────────────────────────────────────
const THEMES = {
  dark:    { bg: '#0d1117', titleBg: '#010409', text: '#e2e8f0', lineNum: '#4b5563' },
  light:   { bg: '#f8fafc', titleBg: '#e2e8f0', text: '#1e293b', lineNum: '#94a3b8' },
  monokai: { bg: '#272822', titleBg: '#1a1a16', text: '#f8f8f2', lineNum: '#75715e' },
};

// ─── Syntax tokenizer ─────────────────────────────────────────────────────────
const KEYWORDS = new Set([
  // JS/TS
  'if','else','for','while','return','const','let','var','function','class',
  'import','export','default','from','new','this','async','await','typeof','instanceof',
  // Python
  'def','elif','True','False','None','and','or','not','in','is','pass','with','as','lambda',
  // Rust
  'fn','pub','let','mut','use','mod','struct','enum','impl','trait','match','where',
  // GLSL
  'void','float','vec2','vec3','vec4','mat4','uniform','varying','attribute','precision',
  'mediump','highp','lowp','in','out','inout',
]);

/**
 * Tokenizes a full code string into [{start, end, text, color}] flat array.
 * Each token covers a contiguous range in the original string.
 * accentColor is used for keywords; T.text for plain text.
 */
function tokenize(code, _language, accentColor, T) {
  const tokens = [];
  let   i = 0;

  const push = (start, end, color) => {
    if (end > start) tokens.push({ start, end, text: code.slice(start, end), color });
  };

  while (i < code.length) {
    const ch = code[i];

    // Newline — plain, preserve for line tracking
    if (ch === '\n') { push(i, i + 1, T.text); i++; continue; }

    // Single-line comment: // or #
    if ((ch === '/' && code[i + 1] === '/') || ch === '#') {
      const end = code.indexOf('\n', i);
      const to  = end === -1 ? code.length : end;
      push(i, to, '#6b7280'); i = to; continue;
    }

    // Block comment /* ... */
    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const to  = end === -1 ? code.length : end + 2;
      push(i, to, '#6b7280'); i = to; continue;
    }

    // String literals: single, double, backtick
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== ch && code[j] !== '\n') {
        if (code[j] === '\\') j++; // skip escaped char
        j++;
      }
      if (code[j] === ch) j++;
      push(i, j, '#4ade80'); i = j; continue;
    }

    // Number
    if (ch >= '0' && ch <= '9') {
      let j = i + 1;
      while (j < code.length && (code[j] >= '0' && code[j] <= '9' || code[j] === '.' || code[j] === 'x' || (code[j] >= 'a' && code[j] <= 'f') || (code[j] >= 'A' && code[j] <= 'F'))) j++;
      push(i, j, '#fb923c'); i = j; continue;
    }

    // Identifier or keyword
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < code.length && isIdentPart(code[j])) j++;
      const word  = code.slice(i, j);
      const color = KEYWORDS.has(word) ? accentColor : T.text;
      push(i, j, color); i = j; continue;
    }

    // Operator / punctuation
    if ('=+-*/%<>!&|(){}[];,.?:'.includes(ch)) {
      push(i, i + 1, '#94a3b8'); i++; continue;
    }

    // Whitespace and anything else — plain
    push(i, i + 1, T.text);
    i++;
  }

  return tokens;
}

function isIdentStart(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$'; }
function isIdentPart(c)  { return isIdentStart(c) || (c >= '0' && c <= '9'); }

/** Convert a 6-digit hex color to rgba(...) with the given opacity. */
function hexWithAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}
