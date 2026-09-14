import { useState } from 'react';
import { X, Copy, Check, BookOpen } from 'lucide-react';
 
/**
 * ScriptDocsModal — reference documentation for the user-script API
 * (motion / canvas / react / shader script kinds, static props, tween
 * helpers, EntityRef/AssetRef, npm imports). Opened from the View menu
 * (see menuBarConfig in App.jsx) via `onOpenScriptDocs`.
 *
 * Two things this is for:
 *  - reading in-app as a quick reference while writing a script
 *  - "Copy for AI" — copies the whole doc as plain Markdown so it can be
 *    pasted into an AI chat alongside a request ("write me a script that
 *    does X using this API"), which is why the content below is kept as
 *    one plain-text constant rather than JSX-only markup.
 *
 * Follows the same modal shell as ScriptEditorModal.jsx (.modal-backdrop /
 * .modal-card, .modal-header / .modal-title-group / .close-btn), with its
 * own width + scrollable body rule (.docs-modal-card / .docs-modal-body
 * in App.css) since the reference content is longer than a settings form.
 */
 
const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'props', label: 'static props' },
  { id: 'motion', label: 'Motion scripts' },
  { id: 'generic-tween', label: 'Generic tween' },
  { id: 'canvas', label: 'Canvas scripts' },
  { id: 'refs', label: 'entity / asset refs' },
  { id: 'react', label: 'React scripts' },
  { id: 'shader', label: 'Shader transitions' },
  { id: 'imports', label: 'npm imports' },
  { id: 'cheatsheet', label: 'Cheat sheet' },
];
 
// Kept as one plain-text constant (not JSX) so "Copy for AI" can put the
// exact same content on the clipboard that's rendered below — no risk of
// the copied text drifting from what's on screen.
export const SCRIPT_API_DOCS_MARKDOWN = `# BlahBlah — User Script API Reference
 
This document describes the scripting API available to user-written scripts
(\`ScriptComponent\`) in the BlahBlah timeline editor. Paste this whole file
into an AI chat along with your request (e.g. "write me a canvas script that
does X using this API") to get scripts that match the runtime contracts
exactly.
 
There are **four kinds of script**, auto-detected from what the code exports
(\`detectScriptKind\` in \`engine/scriptRunner.js\`) — you don't declare the kind,
you just write to the contract and the Inspector figures out which one it is:
 
| Kind     | Shape                                              | Used for |
|----------|-----------------------------------------------------|----------|
| \`motion\` | Class with \`onStart\`/\`onUpdate({ transform, ... })\` | Animating a clip's position/rotation/scale/opacity |
| \`canvas\` | Class with \`onMount\`/\`onUpdate({ container, ... })\` | Custom DOM/Canvas/WebGL rendering inside a clip |
| \`react\`  | Function returning JSX                              | Custom React-rendered clip content |
| \`shader\` | GLSL \`vec4 transition(vec2 uv)\`                     | Custom transitions between clips |
 
All four support:
- \`static props = { ... }\` — declares Inspector-editable (and keyframeable)
  fields.
- Real ES \`import\` statements for npm packages (resolved via esm.sh, cached
  offline after first use) and JSX/TypeScript syntax (transpiled automatically).
 
---
 
## 1. Declaring props (\`static props\`)
 
Any script (motion, canvas, or react) can declare a \`static props\` object.
Each field automatically becomes an editable control in the Inspector, and
(except for \`entity\`/\`asset\` refs) becomes keyframeable.
 
\`\`\`js
static props = {
  speed:   { type: 'number', default: 2.5, min: 0, max: 10, step: 0.1, label: 'Speed' },
  color:   { type: 'color', default: '#ff0000' },
  enabled: { type: 'boolean', default: true },
  mode:    { type: 'select', default: 'a', options: ['a', 'b', 'c'] },
  note:    { type: 'string', default: 'hello' },
  target:  { type: 'entity', label: 'Target Clip' },   // reference to another clip
  clip:    { type: 'asset', label: 'Media Asset' },    // reference to a media asset
};
\`\`\`
 
Shorthand form (direct values instead of \`{ type, default }\`) also works and
infers the type:
 
\`\`\`js
static props = { speed: 2.5, color: '#ff0000', label: 'hello' };
\`\`\`
 
Field \`type\` values: \`number\`, \`color\`, \`boolean\`, \`select\`, \`string\`,
\`entity\`, \`asset\`.
 
- \`entity\`/\`asset\` fields render as drag-drop slots in the Inspector and are
  **never keyframeable** — the slot itself is the whole control. At runtime
  their stored ID is automatically resolved into an \`EntityRef\` / \`AssetRef\`
  object (see §4) before your script sees it — you never see a raw ID string.
- All other typed fields are keyframeable from the Dopesheet.
 
---
 
## 2. \`motion\` scripts — animating a clip's transform
 
Contract (from \`engine/scriptRunner.js\`, \`executeScriptComponent\`):
 
\`\`\`js
export default class MyMotion {
  static props = { amplitude: { type: 'number', default: 20 } };
 
  onStart({ transform, tween, props, time, frame, fps, duration, Math }) {
    // called once per compile; use \`tween\` to set up DOTween-style tweens
  }
 
  onUpdate({ transform, props, time, frame, fps, duration, Math, lerp, clamp, interpolate, spring }) {
    // called every evaluated frame; deterministic — must be a pure function of \`time\`
  }
}
\`\`\`
 
\`transform\` (in both hooks) is a proxy object:
 
\`\`\`js
transform.position.x   // number
transform.position.y   // number
transform.scale.x      // number
transform.scale.y      // number
transform.rotation     // number (degrees)
transform.opacity      // number 0–1
\`\`\`
 
Mutate these directly in \`onUpdate\` for frame-by-frame math (sine waves,
noise, etc.), or use \`tween\` in \`onStart\` to declare DOTween-style animations
that get evaluated deterministically at every \`time\`:
 
\`\`\`js
onStart({ transform, tween }) {
  tween.to(transform.position, { y: -50 }, { duration: 1, ease: 'outBounce' });
  tween.from(transform.position, { y: -200 }, { duration: 1 });
  tween.spring(transform, { rotation: 45 }, { duration: 1.2, damping: 10, stiffness: 100 });
  tween.punch(transform.position, { x: 20 }, { duration: 0.6, vibrato: 8 });
  tween.shake(transform, { intensity: 15, duration: 0.6 });
  tween.sine(transform.position, { y: 10 }, { frequency: 2, phase: 0 });
}
\`\`\`
 
Tween options: \`duration\`, \`delay\`, \`ease\` (name string or function — see
Easing table below), \`loop: 'yoyo'\` / \`loops: N\`, \`relative: true\`.
 
**Timing args available in both hooks:** \`time\` (local seconds since clip
start), \`frame\`, \`fps\`, \`duration\` (clip duration in seconds).
 
### Easing / math helpers
 
\`\`\`js
import { Easing, Ease, LoopType, MathUtils, interpolate, spring } from '...'; // already injected, no import needed
\`\`\`
 
- \`Easing.linear|inQuad|outQuad|inOutQuad|inCubic|outCubic|inOutCubic|inSine|outSine|inOutSine|inBack|outBack|inOutBack|inBounce|outBounce|inOutBounce|inElastic|outElastic|inOutElastic\`
  (also available capitalized as \`Ease.OutBounce\` etc.)
- \`MathUtils.lerp(a, b, t)\`, \`.clamp(v, min, max)\`, \`.clamp01(v)\`,
  \`.remap(v, inMin, inMax, outMin, outMax)\`, \`.degToRad(d)\`, \`.radToDeg(r)\`,
  \`.vec2(x, y)\`, \`.vec3(x, y, z)\`
- \`interpolate(value, inputRange, outputRange, { extrapolateLeft, extrapolateRight, easing })\`
  — Remotion-style range mapping.
- \`spring({ frame, fps, config: { damping, mass, stiffness, initialVelocity } })\`
  — returns 0–1 progress.

---

## Generic tween — deterministic values for every script kind

Use \`tween\` in Canvas lifecycle hooks and motion \`onUpdate\` hooks to
derive values from local timeline time. It is **stateless**: it never starts an
animation, retains progress, uses \`requestAnimationFrame\`, or mutates a
target. This makes preview, scrub, seek, and export agree.

\`Tween\` is the same object. It is passed to Canvas hooks as both \`tween\`
and \`Tween\`; motion \`onUpdate\` receives both too. React scripts can import
it from \`@blahblah/sdk\`.

\`\`\`js
// Canvas or motion onUpdate
onUpdate({ time, tween }) {
  const enter = tween.between(-80, 0, time, {
    at: 0.2, duration: 0.45, ease: 'outBack',
  });
  const pulse = tween.between(1, 1.12, tween.loop(time - 1, 0.5, 'pingpong'));
  const delayForThirdItem = tween.stagger(2, 0.08); // 0.16 seconds
}
\`\`\`

| Helper | Result |
|---|---|
| \`tween.progress(time, { at, duration, ease })\` | Eased 0–1 progress, clamped outside its time window. |
| \`tween.between(from, to, time, options)\` | A numeric value between \`from\` and \`to\`. |
| \`tween.loop(time, duration, 'restart'\|'yoyo')\` | Repeating 0–1 progress. |
| \`tween.pingPong(time, duration)\` | Shorthand for a yoyo loop. |
| \`tween.stagger(index, each)\` | Delay in seconds for a sequential item. |
| \`tween.ease / lerp / clamp / clamp01 / remap\` | Stateless math helpers. |

For legacy transform-track animation, keep using \`tween.to(...)\` inside a
motion script's \`onStart\`. That \`tween\` is a \`MotionTweenContext\` and is
intentionally different from the generic helper supplied to \`onUpdate\`.

---
 
## 3. \`canvas\` scripts — custom rendering (DOM/Canvas/WebGL)
 
Contract (from \`engine/canvasRunner.js\`):
 
\`\`\`js
export default class MyCanvasThing {
  static props = { speed: { type: 'number', default: 1, min: 0, max: 10 } };
 
  onMount({ container, props, canvasWidth, canvasHeight, duration, totalFrames, progress, startTime, endTime, timeLeft }) {
    // container is an empty <div> owned by this clip instance. Build your DOM/canvas/WebGL here.
  }
 
  onUpdate({ container, time, frame, fps, props, tween, canvasWidth, canvasHeight, duration, totalFrames, progress, startTime, endTime, timeLeft }) {
    // called every frame. \`time\` is entity-LOCAL seconds (0 at clip start).
    // tween.between(...) derives a deterministic animation value.
  }
 
  onSeek({ container, time, frame, fps, props, canvasWidth, canvasHeight }) {
    // optional. Fired instead of a normal onUpdate step when the playhead
    // jumps more than ~2 frames (scrub/seek) rather than advancing by one
    // tick — use it to reset any accumulated state (particles, counters).
  }
 
  onUnmount({ container }) {
    // cleanup: dispose renderers, cancel loops, remove listeners
  }
}
\`\`\`
 
- \`canvasWidth\`/\`canvasHeight\` default to the **project's output resolution**
  (not \`container.clientWidth\`, which may be a scaled preview size or 0).
  Override per-instance by declaring \`canvasWidth\`/\`canvasHeight\` in your own
  \`static props\` — the resolved prop value then wins.
- External packages (three, gsap, etc.) come from plain \`import\` statements
  at the top of the file — no separate \`libs\` object, no CDN \`<script>\` tags.
  See §7.
- \`onMount\` is called once per (script code, container) pair — not once per
  frame.
 
---
 
## 4. Reference props — \`entity\` and \`asset\` types
 
Declare a prop as \`{ type: 'entity' }\` or \`{ type: 'asset' }\` and the stored
ID is resolved for you into one of these before your script runs:
 
### \`EntityRef\` (reference to another clip)
 
\`\`\`ts
declare class EntityRef {
  readonly id: string | null;
  readonly name: string | null;
  readonly startTime: number;   // seconds, clip's position on the timeline
  readonly duration: number;    // seconds
  readonly parentId: string | null;
  exists(): boolean;
  getTransform(): { x, y, rotation, scaleX, scaleY, opacity, speed } | null;
  getComponent(type: string): object | null;  // 'VideoRenderer' | 'AudioSource' | 'TextRenderer' | 'ShapeRenderer' | 'SubtitleTrack' | ...
  getPhraseAt(time: number): { text, index, phrase, prev, next } | null; // time = entity-LOCAL seconds
  getCurrentText(time: number): string; // '' when no subtitle or in a gap
}
\`\`\`
 
### \`AssetRef\` (reference to a media asset)
 
\`\`\`ts
declare class AssetRef {
  readonly id: string | null;
  readonly name: string | null;
  readonly src: string | null;   // pass directly to <video>/<audio> src
  readonly type: 'video' | 'audio' | 'image' | null;
  readonly duration: number | null;
  exists(): boolean;
}
\`\`\`
 
Usage in a script:
 
\`\`\`js
static props = { target: { type: 'entity', label: 'Follow Target' } };
 
onUpdate({ transform, props }) {
  if (props.target?.exists()) {
    const t = props.target.getTransform();
    transform.position.x = t.x + 50;
  }
}
\`\`\`
 
These are **read-only** — scripts read live data from other clips but never
write back to them.
 
---
 
## 5. \`react\` scripts — custom React clip content
 
Any script that returns JSX and isn't a class is auto-detected as a React
component:
 
\`\`\`jsx
export default function MyClip({ /* not typically used — read props via static props */ }) {
  return <div style={{ color: 'red' }}>Hello</div>;
}
\`\`\`
 
Or without JSX, using the injected \`h()\` helper (shorthand for
\`React.createElement\`):
 
\`\`\`js
export default function MyClip() {
  return h('div', { style: { color: 'red' } }, 'Hello');
}
\`\`\`
 
\`static props\` works the same way here as for motion/canvas scripts.
 
---
 
## 6. \`shader\` scripts — custom transitions
 
Detected via \`vec4 transition(...)\` / \`gl_FragColor\` in the code. Compatible
with the \`gl-transitions\` GLSL format:
 
\`\`\`glsl
uniform float intensity; // = 1.0
uniform float scanlines; // = 20.0
 
vec4 transition(vec2 uv) {
  vec2 p = uv;
  float d = sin(progress * 3.14159265);
  // getFromColor(uv) / getToColor(uv) sample the outgoing/incoming clips
  vec4 fromColor = getFromColor(p);
  vec4 toColor = getToColor(p);
  return mix(fromColor, toColor, progress); // \`progress\` (0–1) is injected automatically
}
\`\`\`
 
Built-ins available inside \`transition()\`: \`uv\` (arg), \`progress\` (float,
0–1, injected), \`getFromColor(vec2)\`, \`getToColor(vec2)\`.
 
\`uniform\` declarations become Inspector-editable parameters automatically.
Supported uniform types: \`float\`, \`int\`, \`bool\`, \`vec2\`/\`ivec2\`, \`vec3\`, \`vec4\`.
The \`// = <value>\` comment after a uniform sets its default.
 
---
 
## 7. Real \`import\` statements (npm packages)
 
All script kinds support genuine ES \`import\` statements — no bundler config
needed on your end:
 
\`\`\`js
import * as THREE from 'three';
import gsap from 'gsap';
import { someHelper } from './localFile.js'; // relative imports resolve against the project's scripts/ folder
\`\`\`
 
- Packages are fetched once from esm.sh, then cached in IndexedDB — fully
  offline after first use. The resolved version is pinned per package name,
  so \`import 'three'\` always resolves to the same version across sessions
  unless you pin a different one explicitly (\`import 'three@0.160.0'\`).
- Compilation for import-containing scripts is async (background bundle via
  esbuild); the Inspector shows a "Resolving imports…" badge until it
  finishes, then hot-swaps in the compiled result.
- Scripts with **no** imports compile instantly via a lightweight synchronous
  JSX/TS transpiler — no behavior change from imports-free scripts you may
  already have.
 
---
 
## Quick-reference cheat sheet
 
\`\`\`
MOTION   → class, onStart/onUpdate({ transform, tween, props, time, ... })
CANVAS   → class, onMount/onUpdate/onUnmount({ container, props, canvasWidth, canvasHeight, ... })
REACT    → function returning JSX (or h(tag, props, children))
SHADER   → GLSL: uniform ...; vec4 transition(vec2 uv) { ... getFromColor/getToColor/progress ... }
 
static props = { name: { type: 'number'|'color'|'boolean'|'select'|'string'|'entity'|'asset', default, min, max, step, options, label } };
 
tween.to/from/spring/punch/shake/sine(target, props, options)  // motion onStart only
Tween.progress/between/loop/pingPong/stagger/ease/lerp/remap    // generic, all script kinds
Easing.<name> / Ease.<Name>
MathUtils.lerp/clamp/clamp01/remap/degToRad/radToDeg/vec2/vec3
interpolate(value, [in...], [out...], opts)
spring({ frame, fps, config })
 
EntityRef:  id, name, startTime, duration, parentId, exists(), getTransform(), getComponent(type), getPhraseAt(time), getCurrentText(time)
AssetRef:   id, name, src, type, duration, exists()
 
import 'pkg';           // npm package, cached offline after first fetch
import './local.js';     // relative, resolved against scripts/
\`\`\`
`;
 
export function ScriptDocsModal({ isOpen, onClose }) {
  const [copied, setCopied] = useState(false);
 
  if (!isOpen) return null;
 
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SCRIPT_API_DOCS_MARKDOWN);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Copy to clipboard failed:', err);
    }
  };
 
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card docs-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <BookOpen size={18} className="text-emerald" />
            <div>
              <h3>Script API Docs</h3>
              <p className="modal-subtitle">Reference for motion / canvas / react / shader scripts</p>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
 
        <div className="modal-body docs-modal-body">
          <nav className="docs-toc">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#docs-${s.id}`} className="docs-toc-link">
                {s.label}
              </a>
            ))}
          </nav>
 
          <div className="docs-content">
            <DocsMarkdown text={SCRIPT_API_DOCS_MARKDOWN} />
          </div>
        </div>
 
        <div className="script-footer docs-modal-footer">
          <span className="script-hint docs-copy-hint">
            Copies the full reference as Markdown — paste it into an AI chat along with your request.
          </span>
          <button className="unity-btn unity-btn-primary" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Copied!' : 'Copy for AI'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
 
/**
 * Minimal, dependency-free Markdown -> JSX renderer covering just what
 * SCRIPT_API_DOCS_MARKDOWN actually uses (headings, fenced code blocks,
 * tables, bold, inline code, horizontal rules, bullet lists). Not a
 * general Markdown engine — no need to pull in a library for one doc
 * that's fully under our control.
 */
function DocsMarkdown({ text }) {
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;
 
  while (i < lines.length) {
    const line = lines[i];
 
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <pre key={key++} className={`docs-code-block lang-${lang || 'text'}`}>
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }
 
    if (line.startsWith('#')) {
      const level = line.match(/^#+/)[0].length;
      const content = line.replace(/^#+\s*/, '');
      const id = `docs-${content.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
      const Tag = `h${Math.min(level + 1, 6)}`;
      blocks.push(
        <Tag key={key++} id={id} className="docs-heading">
          {renderInline(content)}
        </Tag>
      );
      i++;
      continue;
    }
 
    if (line.trim() === '---') {
      blocks.push(<hr key={key++} className="docs-hr" />);
      i++;
      continue;
    }
 
    if (line.trim().startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push(<DocsTable key={key++} lines={tableLines} />);
      continue;
    }
 
    if (/^\s*-\s+/.test(line)) {
      const itemLines = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        itemLines.push(lines[i].replace(/^\s*-\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="docs-list">
          {itemLines.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }
 
    if (line.trim() === '') {
      i++;
      continue;
    }
 
    // Plain paragraph — collect until a blank line or a new block starts.
    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('#') &&
      lines[i].trim() !== '---' &&
      !lines[i].trim().startsWith('|') &&
      !/^\s*-\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="docs-paragraph">
        {renderInline(paraLines.join(' '))}
      </p>
    );
  }
 
  return <>{blocks}</>;
}
 
function DocsTable({ lines }) {
  // lines[0] = header, lines[1] = separator (---|---), lines[2+] = rows
  const parseRow = (l) =>
    l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
 
  const header = parseRow(lines[0]);
  const rows = lines.slice(2).map(parseRow);
 
  return (
    <table className="docs-table">
      <thead>
        <tr>
          {header.map((h, idx) => (
            <th key={idx}>{renderInline(h)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rIdx) => (
          <tr key={rIdx}>
            {row.map((cell, cIdx) => (
              <td key={cIdx}>{renderInline(cell)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
 
/** Handles `` `code` `` and `**bold**` spans within a line of text. */
function renderInline(str) {
  const parts = str.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={idx}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
