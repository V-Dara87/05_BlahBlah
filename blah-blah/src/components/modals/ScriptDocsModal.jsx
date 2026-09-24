import { useState, useMemo, useRef, useEffect } from 'react';
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
 * own width + scrollable body rule (.docs-modal-card / .docs-modal-body in
 * script-docs-modal.css) since the reference content is longer than a
 * settings form — and because `.modal-body`/`.modal-content` in
 * styles/shared.css are bundled AFTER the component stylesheets, the rules
 * that have to beat them are scoped with two classes (see that file).
 *
 * THE SIDEBAR MENU is derived from the document itself: every entry below
 * names a distinctive fragment of the heading it points at, the heading's DOM
 * id is computed the same way the Markdown renderer computes it, and clicking
 * an entry scrolls the content pane to that heading. Previously the entries
 * hard-coded `#docs-<id>` anchors that no heading actually received, so the
 * menu was inert (and the ids it guessed are not the ids DocsMarkdown
 * generates) — matching against the markdown keeps the two in step through
 * any edit to the document, and a fragment that no longer matches simply drops
 * out of the menu instead of becoming a dead link.
 */

/** Sidebar entries: a short label plus a fragment of the heading it targets. */
const SECTIONS = [
  { id: 'overview', label: 'Overview', match: 'User Script API Reference' },
  { id: 'props', label: 'static props', match: 'Declaring props' },
  { id: 'attributes', label: 'Field attributes', match: 'Field attributes' },
  { id: 'motion', label: 'Motion scripts', match: 'animating a clip' },
  { id: 'generic-tween', label: 'Generic tween', match: 'Generic tween' },
  { id: 'canvas', label: 'Canvas scripts', match: 'custom rendering' },
  { id: 'refs', label: 'entity / asset refs', match: 'Reference props' },
  { id: 'react', label: 'React scripts', match: 'custom React clip content' },
  { id: 'shader', label: 'Shader transitions', match: 'custom transitions' },
  { id: 'imports', label: 'npm imports', match: 'npm packages' },
  { id: 'cheatsheet', label: 'Cheat sheet', match: 'cheat sheet' },
];

/** The DOM id a heading's text gets — the ONE definition of that mapping. */
function headingIdFor(text) {
  return `docs-${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}`;
}

/**
 * Every heading in the document, in order, as `{ text, id }`. Fenced code is
 * skipped: a `#` at the start of a line inside a ``` block is a comment, not a
 * heading, and treating it as one would put a bogus entry in the menu.
 */
function listHeadings(markdown) {
  const headings = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line.startsWith('#')) continue;
    const text = line.replace(/^#+\s*/, '');
    headings.push({ text, id: headingIdFor(text) });
  }
  return headings;
}

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
(except for \`entity\`/\`asset\` refs and \`font\`) becomes keyframeable.

Write it with the **prop helpers**, which are available by name in every script
— there is no import line to add:

\`\`\`js
static props = {
  speed:   num(2.5, { min: 0, max: 10, step: 0.1, unit: '/s' }),   // label: 'Speed (/s)'
  color:   color('#ff0000'),
  enabled: bool(true),
  mode:    select('a', ['a', 'b', 'c']),
  note:    text('hello'),                                        // text(…, { multiline: true }) for a textarea
  font:    font('Inter'),                                        // searchable font picker
  target:  entity({ targetComponent: 'AudioSource', label: 'Audio Track' }), // filter by component
  clip:    asset('image', { label: 'Background Image' }),         // filter by asset type ('image'|'video'|'audio')
};
\`\`\`

| Helper | Field it declares |
| --- | --- |
| \`num(default, opts)\` | number, with \`min\`/\`max\`/\`step\` |
| \`bool(default, opts)\` | checkbox |
| \`color(default, opts)\` | colour picker |
| \`text(default, opts)\` | string; \`{ multiline: true }\` makes it a textarea |
| \`select(default, options, opts)\` | dropdown (\`{ selectButton: true }\` for a button strip) |
| \`asset(assetType, opts)\` | media slot; \`assetType\` is \`'image'\`, \`'video'\` or \`'audio'\` |
| \`entity(opts)\` | entity slot; \`{ targetComponent: 'AudioSource' }\` filters it |
| \`font(default, opts)\` | searchable font-family picker |
| \`button(action, opts)\` | action button (calls the method named \`action\`) |
| \`group(tab, opts, props)\` | applies one tab (and box) to a whole block |
| \`row(props)\` | puts a block's fields on one Inspector row |

\`opts\` is just the field's other keys, so anything in §2 works there too.
\`opts.unit\` appends a unit to the auto-generated label (\`unit: 'px'\` →
"Radius (px)"); an explicit \`opts.label\` wins. The label itself is derived from
the key you assign the field to, so \`startDelay\` becomes "Start Delay" with no
\`label\` to type.

Shorthand values are still accepted in place of a helper — the type is inferred:

\`\`\`js
static props = { speed: 2.5, color: '#ff0000', label: 'hello' };
\`\`\`

Helpers return ordinary prop definitions, so they mix with the long-hand form in
one object. Every one of these lines means the same thing:

\`\`\`js
static props = {
  speed:        num(2.5, { min: 0, max: 10, unit: '/s' }),
  sameThing:    { type: 'number', default: 2.5, min: 0, max: 10, label: 'Same Thing (/s)' },
  shorthandToo: 2.5,
};
\`\`\`

Field \`type\` values: \`number\`, \`color\`, \`boolean\`, \`select\`, \`string\`,
\`textarea\`, \`font\`, \`entity\`, \`asset\`, \`struct\`, \`struct[]\`, \`button\`,
as well as primitive and reference arrays: \`string[]\`, \`number[]\`, \`color[]\`,
\`boolean[]\`, \`select[]\`, \`asset[]\`, \`entity[]\` (or \`type: 'array', itemType: '...'\`).

Every field can also carry **attributes** — see §2 — which describe how it is
laid out (boxes, tabs, inline rows) and when it applies.

\`font\` renders the same searchable Font Family picker the Text Component uses
(a curated list plus the fonts installed on the user's PC). The script receives a
plain family-name string such as \`'Inter'\` or \`'Noto Sans Khmer'\`. It is **not**
keyframeable. Apply it in CSS with quotes and a fallback, e.g.
\`el.style.fontFamily = '"' + props.fontFamily + '", system-ui, sans-serif'\`.

### Primitive and Reference Arrays (\`string[]\`, \`number[]\`, \`asset[]\`, \`entity[]\`)
Declare primitive or reference arrays to expose a reorderable list of simple values or
media/entity references. Each item renders as a compact, single-row editor with drag handles,
delete buttons, and an Add button. The script receives a clean standard JavaScript array:

\`\`\`js
static props = {
  tags:    { type: 'string[]', default: ['intro', 'outro'], label: 'Tags' },
  speeds:  { type: 'number[]', default: [1, 2, 3] },
  images:  { type: 'asset[]',  label: 'Gallery Images' },
  targets: { type: 'entity[]', label: 'Follow Targets' },
};
// In script:
// props.tags -> ['intro', 'outro']
// props.speeds -> [1, 2, 3]
// props.images -> [AssetRef, AssetRef] (each element is an AssetRef)
// props.targets -> [EntityRef, EntityRef] (each element is an EntityRef)
\`\`\`

### Structs and Struct Arrays (\`struct\`, \`struct[]\`)
\`struct\` groups several fields into one object; \`struct[]\` is an editable
list of such objects. Both take a \`fields\` sub-schema, and \`entity\` /
\`asset\` fields inside them are resolved into \`EntityRef\` / \`AssetRef\` too:

\`\`\`js
static props = {
  title: { type: 'struct', label: 'Title', fields: {
    text:  { type: 'string', default: 'Hello' },
    color: { type: 'color',  default: '#ffffff' },
  }},
  items: { type: 'struct[]', label: 'Items', fields: {
    label: { type: 'string', default: '' },
    size:  { type: 'number', default: 1 },
  }},
};
// props.title.text, props.items[0].label ...
\`\`\`


- \`entity\`/\`asset\` fields (and \`entity[]\`/\`asset[]\` array items) render as drag-drop
  slots in the Inspector and are **never keyframeable** — the slot itself is the whole control.
  At runtime their stored ID is automatically resolved into an \`EntityRef\` / \`AssetRef\`
  object (see §5) before your script sees it — you never see a raw ID string.
- \`font\` fields and all array types (\`*[]\`, \`struct[]\`) are not keyframeable.
- All primitive single-value fields (\`number\`, \`color\`, \`boolean\`, \`string\`) are keyframeable from the Dopesheet.

---

## 2. Field attributes — boxes, tabs, conditions, buttons

Attributes are extra keys on a prop definition — the same object a helper's
\`opts\` argument fills in, or (long-hand) the object next to \`type\`/\`default\`.
They change how a field is laid out and when it applies, so a long props list can
read like an Odin/Unity inspector instead of a flat column of rows. Fields with
no attributes render exactly as before.

\`\`\`js
static props = {
  // A group switch: this checkbox turns the whole 'Motion' box on and off.
  animated: bool(true, { label: 'Motion', box: 'Motion', controls: 'Motion' }),

  ...group('Body', { box: 'Motion' }, {
    speed: num(1, { showIf: 'animated' }),
    ...row({ amplitude: num(20), frequency: num(2) }),
  }),

  ...group('Wave', {
    mode: select('sine', ['sine', 'noise'], { selectButton: true }),
    seed: num(0, { button: { label: 'Randomise', action: 'randomise' } }),
    bake: button('bake', { label: 'Bake Wave' }),
  }),
};

randomise({ set }) { set('seed', Math.round(Math.random() * 1000)); }
bake() { /* … */ }
\`\`\`

\`group(tab, opts, props)\` sets the tab on every field inside it (and a box,
when you pass one), so a block does not repeat the same layout keys; \`row()\`
is the same idea for \`inline: true\`. Both are spread with \`...\` into
\`static props\` and keep your field order. A later key overrides an earlier one,
which is how a preset gets adjusted:

\`\`\`js
static props = {
  ...Presets.colors,                                  // the whole Colors box
  nodeStroke: color('#fb7185'),                       // …with one colour repainted
  ...Presets.timing,
  startDelay: num(1.2, { unit: 's' }),                // overrides the preset's 0.3
};
\`\`\`

The built-in blocks are \`Presets.timing\`, \`Presets.audioFx\`,
\`Presets.typography\`, \`Presets.colors\` and \`Presets.fitTransform\` — the
timing, sound-effect, font, palette and fit/transform fields, ready to drop in.

### Grouping and layout

Fields with the same name share a group. Groups render where their first member
was declared, so members do not have to be adjacent.

| Attribute | Effect |
| --- | --- |
| \`box: 'Name'\` | a titled box around its members |
| \`foldout: 'Name'\` | the same, but collapsible |
| \`tab: 'Name'\` | a tab; tabs are the outermost grouping (a tab only appears if it has visible fields) |
| \`inline: true\` | shares one row with the inline fields next to it |
| \`title: 'Heading'\` | a heading row above this field |
| \`space: true\` or \`space: 12\` | vertical space above this field |

### Conditions

Conditions are expressions over the other props in the same schema, so they read
like ordinary script code. A condition that cannot be evaluated (a typo, a prop
that no longer exists) leaves the field visible and editable — it never hides a
field by accident.

| Attribute | Effect |
| --- | --- |
| \`showIf: 'enabled'\` | draw the field only while the expression is truthy |
| \`hideIf: 'locked'\` | draw the field only while the expression is falsy |
| \`enableIf: 'enabled && speed > 2'\` | draw it, but greyed out and uneditable unless true |
| \`disableIf: 'locked'\` | the inverse of \`enableIf\` |

### Controls

| Attribute | Effect |
| --- | --- |
| \`toggleLeft: true\` | checkbox first, label after it (a boolean row that reads as one line) |
| \`selectButton: true\` | render a \`select\` as a strip of buttons instead of a dropdown |
| \`controls: 'Name'\` | on a boolean: this checkbox switches the group named \`Name\`, dimming its members when off |
| \`button: 'method'\` | a small action button next to the field |
| \`button: { label: 'Bake', action: 'bake', variant: 'primary' }\` | the same, with a label and styling (\`primary\` / \`danger\`) |

The aliases \`boxGroup\`, \`foldoutGroup\`, \`tabGroup\`, \`horizontal\`, \`enumButtons\`
and \`toggleGroup\` are accepted as well. Struct and \`struct[]\` subfields take the
same attributes as top-level fields, so a nested struct can carry its own
conditions and inline rows.

### Action buttons

A field of \`{ type: 'button' }\` renders a full-width button; its \`action\` names a
method on your script (defaulting to the field name), and clicking it calls that
method. Buttons work on every script kind:

- a **motion** script method is called on an instance kept for the component;
- a **canvas** script's live mounted instance is used when there is one, so the
  button sees the same Three.js/WebGL state \`onUpdate\` sees;
- a **React** clip can attach a helper to the component (\`MyClip.reset = () => …\`)
  or expose a \`static\` method.

The method receives one object:

\`\`\`js
bake({ props, set, setAll, refresh, entity, entityId, scriptId, time, frame, fps, duration }) {
  // props   — the same resolved props your onUpdate receives
  // set     — (name, value) write one prop
  // setAll  — (patch) write several
  // ...and the usual local timing args
}
\`\`\`

\`set\`/\`setAll\` write plain values: a click is not an edit at the playhead, so an
action never creates a keyframe. Both are undoable like any other inspector edit,
and the result of the method (including a rejected promise) is reported under the
field list — a broken button shows its error instead of failing silently.

---

## 3. \`motion\` scripts — animating a clip's transform

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
start), \`timelineTime\` (global timeline time in seconds), \`frame\`, \`fps\`, \`duration\` (clip duration in seconds).

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
| \`tween.loop(time, duration, mode)\` | Repeating 0–1 progress. \`mode\` is \`'restart'\` (default), \`'yoyo'\` or \`'pingpong'\` (the last two behave the same). |
| \`tween.pingPong(time, duration)\` | Shorthand for a yoyo loop. |
| \`tween.stagger(index, each)\` | Delay in seconds for a sequential item. |
| \`tween.ease / lerp / clamp / clamp01 / remap\` | Stateless math helpers. |

For legacy transform-track animation, keep using \`tween.to(...)\` inside a
motion script's \`onStart\`. That \`tween\` is a \`MotionTweenContext\` and is
intentionally different from the generic helper supplied to \`onUpdate\`.

---

## 4. \`canvas\` scripts — custom rendering (DOM/Canvas/WebGL)

Contract (from \`engine/canvasRunner.js\`):

\`\`\`js
export default class MyCanvasThing {
  static props = { speed: { type: 'number', default: 1, min: 0, max: 10 } };

  onMount({ container, signal, props, canvasWidth, canvasHeight, aspect, tween, duration, totalFrames, progress, startTime, endTime, timeLeft }) {
    // container is an empty <div> owned by this clip instance. Build your DOM/canvas/WebGL here.
  }

  onUpdate({ container, time, frame, fps, props, tween, canvasWidth, canvasHeight, aspect, duration, totalFrames, progress, startTime, endTime, timeLeft }) {
    // called every frame. \`time\` is entity-LOCAL seconds (0 at clip start).
    // tween.between(...) derives a deterministic animation value.
  }

  onSeek({ container, time, frame, fps, props, tween, canvasWidth, canvasHeight, duration, totalFrames, progress, startTime, endTime, timeLeft }) {
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
  See §8.
- \`onMount\` is called once per (script code, container) pair — not once per
  frame.
- \`signal\` (an \`AbortSignal\`) is passed to \`onMount\` only. It aborts when the
  clip unmounts, so pass it to \`fetch\` / \`addEventListener\` to cancel async work.
- \`aspect\` is \`canvasWidth / canvasHeight\`. The runner also sets
  \`this.canvasWidth\`, \`this.canvasHeight\` and \`this.aspect\` on your instance.
- If your instance has a \`renderer\` (a Three.js \`WebGLRenderer\`) or a \`canvas\`
  property, its DOM element is re-attached to \`container\` if it is missing.
- If your instance has a \`renderer\`, it is resized to the project size for you,
  and so is \`this.camera\` when it is a \`PerspectiveCamera\` (an
  \`OrthographicCamera\` is **not** updated). Set \`this.autoResize = false\` to turn
  this off. A plain \`canvas\` is never resized for you.

---

## 5. Reference props — \`entity\` and \`asset\` types

Declare a prop as \`{ type: 'entity' }\` or \`{ type: 'asset' }\` (or array equivalents \`entity[]\`, \`asset[]\`).
The stored ID is automatically resolved into an \`EntityRef\` or \`AssetRef\` instance before your script runs:

### Filtering & Auto-Identification
- **\`targetComponent\`**: Filters clips in the dropdown and drag-and-drop slots by component (e.g. \`targetComponent: 'AudioSource'\`, \`'VideoRenderer'\`, \`'SubtitleTrack'\`).
- **\`assetType\`**: Filters media assets by kind (\`'audio'\` | \`'video'\` | \`'image'\`).
- **Auto-Identification**: Dropdowns automatically display track context, timeline time ranges, and a short auto-generated ID hash:  
  \`[Track 1] BGM.mp3 (00:00.0 - 01:30.0) #8a2f\`.

### \`EntityRef\` (reference to another clip)

\`\`\`ts
declare class EntityRef {
  readonly id: string | null;
  readonly name: string | null;
  readonly startTime: number;   // seconds, clip's position on the timeline
  readonly duration: number;    // seconds
  readonly endTime: number;     // seconds, clip's end on the timeline (startTime + duration)
  readonly parentId: string | null;
  readonly trackId: string | null;
  readonly audioSrc: string | null;      // audio media URL if entity has AudioSource
  readonly audioDuration: number | null; // audio media duration in seconds
  exists(): boolean;
  getTransform(): { x, y, rotation, scaleX, scaleY, opacity, speed } | null;
  getComponent(type: string): object | null;  // 'VideoRenderer' | 'AudioSource' | 'TextRenderer' | 'ShapeRenderer' | 'SubtitleTrack' | ...
  getPhraseAt(time: number): SubtitlePhraseContext | null; // time = entity-LOCAL seconds; null if no SubtitleTrack / no phrases
  getCurrentText(time: number): string; // '' when no subtitle or in a gap

  // Audio Sync API (when referencing an AudioSource clip):
  isPlayingAt(timelineTime: number): boolean; // returns true if playing at timeline time
  getAudioTime(time: number, isLocalTime?: boolean): number | null; // audio media playback position (seconds)
  getAudioProgress(time: number, isLocalTime?: boolean): number; // normalized progress [0.0, 1.0]
  getAudioSettings(): { volume, speed, effectiveSpeed, mediaOffset, muted, loop, src } | null;
}
\`\`\`

### Audio Synchronization Example

Synchronize script animations to a referenced audio clip with exact timing (compensating for clip start time, media offset, and clip playback speed):

\`\`\`js
export default class AudioSyncedVisualizer {
  static props = {
    audioTrack: { type: 'entity', targetComponent: 'AudioSource', label: 'Audio Clip' },
  };

  onUpdate({ timelineTime, props }) {
    const audio = props.audioTrack;
    if (audio?.isPlayingAt(timelineTime)) {
      const audioTime = audio.getAudioTime(timelineTime); // playback position within audio
      const progress = audio.getAudioProgress(timelineTime); // 0.0 -> 1.0 progress through clip
      // Drive animation based on audio progress or timing
    }
  }
}
\`\`\`

### \`SubtitlePhraseContext\` (returned by \`getPhraseAt\`)

\`\`\`ts
{
  text: string;                       // what to display — see note below
  sentenceText: string;               // text of the current sentence group
  sentencePhrases: SubtitlePhrase[];  // phrases in the current sentence group
  accumulatedText: string;            // text of every phrase up to now
  accumulatedPhrases: SubtitlePhrase[];
  index: number | null;               // null during a gap
  phrase: SubtitlePhrase | null;      // null during a gap
  prev: SubtitlePhrase | null;
  next: SubtitlePhrase | null;
}
// SubtitlePhrase: { id, startTime, endTime, text, mode: 'set'|'add', duration?, words?, emphasis? }
\`\`\`

**\`text\` is not always just the current phrase.** In \`'set'\` mode it is only the
active phrase. In \`'add'\` mode (per-phrase \`mode\`, or the track's \`displayMode\`)
it is the whole sentence built up so far. Use \`phrase.text\` if you always want
the single active phrase.

### \`AssetRef\` (reference to a media asset)

\`\`\`ts
declare class AssetRef {
  readonly id: string | null;
  readonly name: string | null;
  readonly src: string | null;   // pass directly to <video>/<audio> src
  readonly type: 'video' | 'audio' | 'image' | null;
  readonly duration: number | null;
  readonly isPlaying: boolean;
  exists(): boolean;

  // Audio Firing API:
  play(options?: { volume?: number, speed?: number, playbackRate?: number, loop?: boolean, offset?: number }): HTMLAudioElement | null;
  playOneShot(options?: { volume?: number, speed?: number, playbackRate?: number, offset?: number }): HTMLAudioElement | null;
  pause(): void;
  stop(): void;
}
\`\`\`

### Audio Firing / Sound Effects Example

Trigger attached audio assets or clips directly from your script (e.g. on a specific frame, collision event, or button click):

\`\`\`js
export default class SoundEffectTrigger {
  static props = {
    hitSfx: { type: 'asset', assetType: 'audio', label: 'Hit SFX' },
  };

  onUpdate({ frame, props }) {
    if (frame === 15) {
      // playOneShot fires a standalone audio instance that cleans itself up
      props.hitSfx?.playOneShot({ volume: 0.8, speed: 1.2 });
    }
  }
}
\`\`\`

Usage in a motion script:

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

## 6. \`react\` scripts — custom React clip content

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

## 7. \`shader\` scripts — custom transitions

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

## 8. Real \`import\` statements (npm packages)

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

static props = { name: { type: 'number'|'color'|'boolean'|'select'|'string'|'textarea'|'font'|'entity'|'asset'|'string[]'|'number[]'|'asset[]'|'entity[]'|'struct'|'struct[]', default, min, max, step, options, label } };

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
import './script-docs-modal.css';

export function ScriptDocsModal({ isOpen, onClose }) {
  const [copied, setCopied] = useState(false);
  const contentRef = useRef(null);
  const [activeId, setActiveId] = useState(SECTIONS[0].id);

  /**
   * The sidebar entries, each resolved to the id of the heading it names —
   * against the document's OWN headings, so every entry is guaranteed to point
   * at something (see SECTIONS for why the old hrefs did not).
   */
  const menu = useMemo(() => {
    const headings = listHeadings(SCRIPT_API_DOCS_MARKDOWN);
    return SECTIONS.map((section) => {
      const needle = section.match.toLowerCase();
      const heading = headings.find((h) => h.text.toLowerCase().includes(needle));
      return heading ? { ...section, headingId: heading.id } : null;
    }).filter(Boolean);
  }, []);

  // Keep the highlighted entry in step with the reading position — including
  // right after a click-jump, which would otherwise leave the previous entry
  // lit until the next scroll event. One rAF per scroll burst, the same
  // coalescing the timeline uses for its own redraws.
  useEffect(() => {
    if (!isOpen) return undefined;
    const container = contentRef.current;
    if (!container || menu.length === 0) return undefined;

    const targets = menu
      .map((item) => ({ id: item.id, el: document.getElementById(item.headingId) }))
      .filter((target) => target.el);
    if (targets.length === 0) return undefined;

    let frame = 0;
    const sync = () => {
      frame = 0;
      const containerTop = container.getBoundingClientRect().top;
      let current = targets[0].id;
      for (const target of targets) {
        // 24px of slack, so the heading a jump just landed on counts as the
        // current one (it sits 8px below the top edge) rather than the one
        // before it.
        if (target.el.getBoundingClientRect().top - containerTop <= 24) current = target.id;
        else break;
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(sync);
    };

    sync();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [isOpen, menu]);

  if (!isOpen) return null;

  /** Scroll the content pane to a section. The menu navigates nothing else. */
  const handleJump = (item) => {
    const container = contentRef.current;
    const heading = document.getElementById(item.headingId);
    if (!container || !heading) return;
    const top =
      heading.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 8;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    container.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
    setActiveId(item.id);
  };

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
          <nav className="docs-toc" aria-label="Document sections">
            {menu.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`docs-toc-link${activeId === item.id ? ' active' : ''}`}
                onClick={() => handleJump(item)}
                aria-current={activeId === item.id ? 'true' : undefined}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="docs-content" ref={contentRef}>
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
      const id = headingIdFor(content);
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