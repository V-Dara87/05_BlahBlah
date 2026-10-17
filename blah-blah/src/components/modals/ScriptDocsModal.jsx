import { useState, useMemo, useRef, useEffect } from 'react';
import { X, Copy, Check, BookOpen } from 'lucide-react';

/**
 * ScriptDocsModal — reference documentation for the user-script API
 * (motion / canvas / react / shader script kinds, static props, tween
 * helpers, EntityRef/AssetRef, npm imports). Opened from the View menu
 * (see menuBarConfig in App.jsx) via `onOpenScriptDocs`.
 */

/** Sidebar entries: a short label plus a fragment of the heading it targets. */
const SECTIONS = [
  { id: 'ai-rules', label: 'AI Rules & Guidelines', match: 'Rules for AI Code Generators' },
  { id: 'overview', label: 'Overview', match: 'Overview' },
  { id: 'props', label: 'static props', match: 'Declaring props' },
  { id: 'attributes', label: 'Field attributes', match: 'Field attributes' },
  { id: 'motion', label: 'Motion scripts', match: 'animating a clip' },
  { id: 'generic-tween', label: 'Generic tween', match: 'Generic tween' },
  { id: 'sequences', label: 'Seekable sequences', match: 'Seekable sequences' },
  { id: 'memoize', label: 'memoizeByProps', match: 'memoizeByProps' },
  { id: 'canvas', label: 'Canvas scripts', match: 'custom rendering' },
  { id: 'gizmos', label: 'Script gizmos', match: 'Script gizmos' },
  { id: 'refs', label: 'entity / asset refs', match: 'Reference props' },
  { id: 'react', label: 'React scripts', match: 'custom React clip content' },
  { id: 'shader', label: 'Shader transitions', match: 'custom transitions' },
  { id: 'imports', label: 'npm imports', match: 'npm packages' },
  { id: 'three', label: 'Three.js 3D scripts', match: 'Three.js 3D' },
  { id: 'examples', label: 'Full Working Examples', match: 'Full Working Examples' },
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
function listHeadings(markdownText) {
  const headings = [];
  let inFence = false;
  for (const line of markdownText.split('\n')) {
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

// Reference markdown constant exported for in-app viewing and AI prompt copying.
export const SCRIPT_API_DOCS_MARKDOWN = `# BlahBlah — User Script API Reference

This document is the authoritative reference for writing user scripts (\`ScriptComponent\`) in the BlahBlah timeline editor.

> **CRITICAL INSTRUCTIONS FOR AI CODE GENERATORS:**
> When asked to generate a BlahBlah script, follow these rules strictly to avoid runtime errors:
> 
> 1. **Pick Exactly One Contract**: Choose \`canvas\`, \`motion\`, \`react\`, or \`shader\`. Never mix methods from different contracts.
> 2. **For 2D Canvas Graphics**: Always \`import { CanvasComponent } from '@blahblah/sdk';\` and extend it. It automatically creates the \`<canvas>\`, tracks resolution, provides \`this.ctx\`, \`this.centerOrigin()\`, \`this.restoreOrigin()\`, and \`this.toScreen()\`. Do NOT override \`onMount()\` unless necessary (and if you do, you MUST call \`super.onMount(args)\`). Prefer writing all drawing in \`onUpdate({ time, props })\`.
> 3. **For 3D Graphics**: Always \`import { ThreeComponent } from '@blahblah/sdk';\` and \`import * as THREE from 'three';\`. It automatically manages WebGL renderer sizing, perspective camera aspect ratio, and disposal.
> 4. **Container Sizing**: NEVER set \`container.style.width\` or \`container.style.height\` to \`'100%'\`. The container is already sized in project output pixels.
> 5. **Deterministic Animations**: \`onUpdate\` must be a pure function of \`time\` (local seconds) or \`frame\`. Never accumulate wall-clock deltas (\`this.x += 1\`) without handling \`onSeek\`.
> 6. **Prop Helpers**: Use \`num()\`, \`bool()\`, \`color()\`, \`text()\`, \`select()\`, \`asset()\`, \`entity()\`, \`font()\`, \`button()\`, \`group()\`, \`row()\`, and \`Presets\`. They are injected globally into script scope (no import needed).
> 7. **Interactive Gizmos**: Implement \`getGizmos({ props, canvasWidth, canvasHeight })\` or add \`gizmo: true\` to props. In default \`space: 'local'\`, \`(0, 0)\` is the canvas center. Name position fields \`x\` and \`y\`.
> 8. **Reference Props**: When using \`type: 'entity'\` or \`type: 'asset'\`, props resolve to \`EntityRef\` or \`AssetRef\` instances with helper methods like \`getTransform()\`, \`getAudioProgress(time)\`, \`getPhraseAt(localTime)\`, and \`playOneShot()\`. Always check \`prop?.exists()\`.

---

## Rules for AI Code Generators

Before writing any script code, review this checklist:

- **Compiled with esbuild:** Every script — with or without \`import\` — is compiled by esbuild, so JSX, TypeScript, and npm imports all work the same way.
- **Errors show in the Console:** A compile or runtime error appears in the Console panel tagged with the script name and line/column, so nothing fails silently.
- **Props are validated:** \`static props\` types, min/max ranges, select options, struct fields, and button methods are checked, and warnings appear as a yellow badge in the Inspector.

| Task | Correct Pattern | Incorrect Pattern (Do NOT do this) |
|---|---|---|
| **2D Canvas script** | \`class MyScript extends CanvasComponent\` | Hand-rolling raw \`<canvas>\` without handling resize or container cleanup |
| **Canvas Center Origin** | \`this.centerOrigin(); /* draw at (0,0) */; this.restoreOrigin();\` | Hardcoding \`canvasWidth / 2\` on every single coordinate call |
| **3D Three.js script** | \`class MyScene extends ThreeComponent\` | Creating \`WebGLRenderer\` manually without resizing or cleanup on unmount |
| **Motion script** | Class with \`onStart({ transform, tween })\` / \`onUpdate({ transform, time })\` | Extending \`CanvasComponent\` for transform animation, or returning JSX |
| **Props declaration** | \`static props = { speed: num(1.5, { min: 0, max: 10 }) };\` | Using plain TypeScript interfaces without \`static props\` runtime object |
| **Array & struct defaults** | \`const items = props.items?.length ? props.items : DEFAULT_ITEMS;\` | \`const items = props.items || [];\` (when unedited, \`props.items\` is undefined, so \`|| []\` leaves array empty and draws 0 items!) |
| **Gizmo property naming** | Name position fields \`x\` and \`y\` in your struct: \`{ x: num(0), y: num(0) }\` | Naming them \`xOffset\`, \`posX\`, etc. (\`updateGizmoProperty\` explicitly writes to \`.x\` and \`.y\` on drag) |
| **Gizmo visibility** | Select the clip in the timeline/hierarchy to show handles in preview | Expecting gizmos to show on unselected clips (gizmos only render when \`isSelected === true\`) |
| **Typography & Fonts** | Use \`fontFamily: font('Inter')\` and draw with \`ctx.font = '800 24px "' + props.fontFamily + '", sans-serif'\` | Hardcoding \`font = "24px Arial"\` without exposing a font picker prop |
| **Subtitle Integration** | \`const sub = props.subtitleSource?.getPhraseAt(time); if (sub?.text) draw(sub.text);\` | Manually iterating phrases without respecting phrase \`mode\` (\`SET\` vs \`ADD\`) |
| **Deterministic time** | \`const x = Math.sin(time * speed) * 100;\` | \`this.x += speed * dt;\` (breaks scrubber, keyframing, and offline export) |
| **Container styling** | Style child elements absolutely: \`el.style.left = ...\` | \`container.style.width = '100%'\` (breaks editor preview scaling) |
| **Audio SFX triggering** | \`props.sfx?.playOneShot({ volume: 0.8 });\` | Creating new \`new Audio()\` instances manually |
| **Animation over time** | \`tween.between(0, 100, time, { at: 0.5, duration: 1 })\` | Calling \`requestAnimationFrame\` inside \`onUpdate\` |

---

## Overview

BlahBlah auto-detects the script kind from the exported code (\`detectScriptKind\` in \`engine/scriptRunner.js\`). You don't declare the kind; you just follow the matching contract:

| Kind | Detection Signature | Base Class | Primary Purpose |
|---|---|---|---|
| **\`canvas\`** | Extends \`CanvasComponent\` / \`ThreeComponent\`, or defines \`onMount\`/\`onUpdate({ container })\` | \`CanvasComponent\` or \`ThreeComponent\` | Custom 2D graphics, WebGL, Three.js, SVG, or DOM rendering |
| **\`motion\`** | Class with \`onStart\` / \`onUpdate({ transform })\` | Standalone class or \`MotionScript\` | Procedural transform animation (position, rotation, scale, opacity) |
| **\`react\`** | Function returning JSX or calling \`h()\` / \`React.createElement\` | None (functional component) | Custom React UI overlays and animated React clip content |
| **\`shader\`** | GLSL code containing \`vec4 transition(vec2 uv)\` or \`gl_FragColor\` | None (GLSL string) | Custom GPU transition shaders between clips |

All script kinds support:
- \`static props = { ... }\` — declares Inspector controls and keyframe tracks.
- Real ES \`import\` statements for npm packages (resolved via esm.sh, cached offline in IndexedDB).
- JSX and TypeScript syntax (transpiled automatically in-browser with esbuild).

---

## 1. Declaring props (\`static props\`)

Any script (motion, canvas, or react) can declare a \`static props\` object. Each field automatically becomes an editable control in the Inspector, and (except for \`entity\`/\`asset\` refs and \`font\`) becomes keyframeable in the Dopesheet.

Write it with the **prop helpers**, which are available by name in every script — there is no import line to add:

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
  action:  button('resetValues', { label: 'Reset' }),
};
\`\`\`

### Prop Helpers Summary

| Helper | Field it declares | Description |
| --- | --- | --- |
| \`num(default, opts)\` | \`number\` | Number input with \`min\`, \`max\`, \`step\`, optional \`slider: true\`, \`unit\` |
| \`bool(default, opts)\` | \`boolean\` | Switch checkbox; supports \`toggleLeft: true\`, \`controls: 'Group'\` |
| \`color(default, opts)\` | \`color\` | Color picker with hex input and color eyedropper |
| \`text(default, opts)\` | \`string\` / \`textarea\` | Text input; \`{ multiline: true }\` renders a multi-line textarea |
| \`select(default, options, opts)\` | \`select\` | Dropdown menu; \`{ selectButton: true }\` renders a button strip |
| \`asset(assetType, opts)\` | \`asset\` | Media asset slot; \`assetType\` is \`'image'\`, \`'video'\`, or \`'audio'\` |
| \`entity(opts)\` | \`entity\` | Timeline entity slot; \`{ targetComponent: 'SubtitleTrack' \| 'AudioSource' }\` |
| \`font(default, opts)\` | \`font\` | Searchable font-family picker (Google Fonts + local PC fonts) |
| \`button(action, opts)\` | \`button\` | Action button (triggers the script method named \`action\`) |
| \`group(tab, opts, props)\` | *(grouping)* | Applies tab and box attributes to a whole block of props |
| \`row(props)\` | *(grouping)* | Puts a block's fields on one horizontal Inspector row |
| \`Presets\` | *(presets)* | Pre-built prop packs: \`timing\`, \`audioFx\`, \`typography\`, \`colors\`, \`fitTransform\` |

\`opts\` is the field's options object. \`opts.unit\` appends a unit to the auto-generated label (\`unit: 'px'\` → "Radius (px)"); an explicit \`opts.label\` wins. The label is automatically derived from the key if omitted (\`startDelay\` → "Start Delay").

### Built-in Presets (\`Presets\`)

Spread pre-packaged Inspector blocks directly into your \`static props\`:

\`\`\`js
static props = {
  // Timing tab: fitToDuration, startDelay, stepDelay, animDuration, ease, endHold, exitAt, autoFadeOut
  ...Presets.timing,

  // Audio FX tab: nodeSfx, edgeSfx, sfxVolume, previewSfx
  ...Presets.audioFx,

  // Style > Typography: fontFamily, fontSize, fontWeight
  ...Presets.typography,

  // Style > Colors: nodeFill, nodeStroke, textColor, edgeColor, strokeWidth, arrowSize
  ...Presets.colors,

  // Style > Transform: autoFit, padding, scale, chartSize, offsetX, offsetY
  ...Presets.fitTransform,
};
\`\`\`

### Right-Click Context Menu & Inspector Features

- **Copy / Paste / Reset Value**: Right-click on any field in the Inspector to copy its serialized value, paste clipboard data (with type-safe coercion), or reset it to the default declared in \`static props\`.
- **Modified Indicator**: Fields whose current value differs from default are styled in bold with a distinct modified accent.
- **Script Card Toolbar**:
  - **Copy Props**: Copies all script prop values to clipboard as JSON.
  - **Paste Props**: Pastes matching property names and types without corrupting incompatible keys.
  - **Reset Props**: Resets all script properties back to their initial defaults.
  - **Enabled**: Toggles the script execution on and off.

### Primitive and Reference Arrays (\`string[]\`, \`number[]\`, \`asset[]\`, \`entity[]\`)

Declare primitive or reference arrays to expose a reorderable, draggable list:

\`\`\`js
static props = {
  tags:    { type: 'string[]', default: ['intro', 'outro'], label: 'Tags' },
  speeds:  { type: 'number[]', default: [1, 2, 3] },
  images:  { type: 'asset[]',  assetType: 'image', label: 'Gallery Images' },
  targets: { type: 'entity[]', label: 'Follow Targets' },
};
// In script onUpdate:
// props.tags    -> ['intro', 'outro']
// props.speeds  -> [1, 2, 3]
// props.images  -> [AssetRef, AssetRef]
// props.targets -> [EntityRef, EntityRef]
\`\`\`

### Structs and Struct Arrays (\`struct\`, \`struct[]\`)

\`struct\` groups several fields into one object; \`struct[]\` is an editable list of objects. Both take a \`fields\` sub-schema:

\`\`\`js
static props = {
  title: {
    type: 'struct',
    label: 'Title',
    fields: {
      text:  { type: 'string', default: 'Hello' },
      color: { type: 'color',  default: '#ffffff' },
    },
  },
  items: {
    type: 'struct[]',
    label: 'Items',
    gizmo: true,
    fields: {
      label: text(''),
      size:  num(1),
      x:     num(0, { min: -1920, max: 1920 }),
      y:     num(0, { min: -1080, max: 1080 }),
    },
  },
};
// props.title.text, props.items[0].label, props.items[0].x ...
\`\`\`

---

## 2. Field attributes — boxes, tabs, conditions, buttons

Attributes customize how fields are laid out in the Inspector:

\`\`\`js
static props = {
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

### Grouping and Layout Attributes

| Attribute | Effect |
| --- | --- |
| \`tab: 'Name'\` (or \`tabGroup\`) | Places fields inside the named tab bar at the top of the card |
| \`box: 'Name'\` (or \`boxGroup\`) | Groups fields inside a titled card panel |
| \`foldout: 'Name'\` (or \`foldoutGroup\`) | Collapsible box panel (expandable/collapsible by user) |
| \`inline: true\` (or \`horizontal: true\`) | Shares one row with adjacent inline fields (compact layout) |
| \`title: 'Heading'\` | Section divider row rendered above this field |
| \`space: true\` or \`space: 12\` | Vertical space in pixels above this field |

### Condition Attributes

| Attribute | Effect |
| --- | --- |
| \`showIf: 'expression'\` | Draw the field only while the expression evaluates to truthy |
| \`hideIf: 'expression'\` | Draw the field only while the expression evaluates to falsy |
| \`enableIf: 'expression'\` | Draw it, but greyed out and uneditable unless expression is true |
| \`disableIf: 'expression'\` | The inverse of \`enableIf\` |

Conditions can reference any sibling prop names (e.g. \`showIf: "enabled && speed > 2"\` or \`showIf: "textSource === 'manual'"\`).

### Control Attributes & Action Buttons

| Attribute | Effect |
| --- | --- |
| \`toggleLeft: true\` | Checkbox first, label after it (Odin-style ToggleLeft) |
| \`selectButton: true\` | Render a \`select\` dropdown as a strip of segmented buttons |
| \`controls: 'GroupName'\` | On a boolean: binds as the header switch for the box/foldout group, enabling/disabling all members |
| \`button: 'method'\` | Small action button rendered directly next to the field |
| \`button: { label, action, variant }\` | Side button with custom label and style (\`variant: 'primary'\` / \`'danger'\`) |
| \`type: 'button'\` | Full-row action button that triggers \`action\` method on click |

### Action Method Signature

Action methods declared by buttons receive a helper payload for modifying props and inspecting state:

\`\`\`js
bake({ props, set, setAll, refresh, entity, entityId, scriptId, time, frame, fps, duration }) {
  set('speed', 2.0);                           // update a single prop
  setAll({ amplitude: 50, frequency: 1.5 });   // batch update multiple props
}
\`\`\`

---

## 3. \`motion\` scripts — animating a clip's transform

Motion scripts procedurally animate an entity's transform (position, rotation, scale, and opacity):

\`\`\`js
export default class MyMotion {
  static props = { amplitude: num(20) };

  onStart({ transform, tween, props, time, frame, fps, duration, Math, Tween }) {
    // tween is MotionTweenContext (DOTween style)
    tween.to(transform.position, { y: -50 }, { duration: 1, ease: 'outBounce' });
    tween.spring(transform, { rotation: 45 }, { duration: 1.2, damping: 10, stiffness: 100 });
    tween.punch(transform.position, { x: 20 }, { duration: 0.6, vibrato: 8 });
    tween.shake(transform, { intensity: 15, duration: 0.6 });
    tween.sine(transform.position, { y: 10 }, { frequency: 2, phase: 0 });
  }

  onUpdate({ transform, props, time, frame, fps, duration, Math, lerp, clamp, interpolate, spring, tween, Tween }) {
    // transform is a proxy with position, scale, rotation, opacity
    transform.position.y += Math.sin(time * 3) * props.amplitude;
  }
}
\`\`\`

\`transform\` proxy properties:
\`\`\`js
transform.position.x   // number (pixels)
transform.position.y   // number (pixels)
transform.scale.x      // number (multiplier, default 1)
transform.scale.y      // number (multiplier, default 1)
transform.rotation     // number (degrees)
transform.opacity      // number (0 to 1)
\`\`\`

### Ignore Parent Speed

Motion scripts follow the clip's Transform Speed (playback rate) by default. The Inspector provides an **Ignore Parent Speed** toggle for motion scripts: when checked, the script's \`localTime\` stays on raw timeline time while media and sibling scripts run sped up.

---

## Generic tween — deterministic values for every script kind

Use \`tween\` in Canvas lifecycle hooks and motion \`onUpdate\` hooks to derive values from local timeline time. It is **stateless**: it never starts an animation, retains progress, or uses \`requestAnimationFrame\`.

\`\`\`js
onUpdate({ time, tween }) {
  const enter = tween.between(-80, 0, time, { at: 0.2, duration: 0.45, ease: 'outBack' });
  const pulse = tween.between(1, 1.12, tween.loop(time - 1, 0.5, 'pingpong'));
  const delayForThirdItem = tween.stagger(2, 0.08); // 0.16 seconds
}
\`\`\`

| Helper | Result |
|---|---|
| \`tween.progress(time, { at, duration, ease })\` | Eased 0–1 progress, clamped outside its time window |
| \`tween.between(from, to, time, options)\` | A numeric value interpolated between \`from\` and \`to\` |
| \`tween.loop(time, duration, mode)\` | Repeating 0–1 progress (\`'restart'\`, \`'yoyo'\`, or \`'pingpong'\`) |
| \`tween.pingPong(time, duration)\` | Shorthand for a yoyo loop |
| \`tween.stagger(index, each)\` | Delay in seconds for a sequential item |
| \`tween.ease / lerp / clamp / clamp01 / remap\` | Stateless math helpers |

### Seekable sequences — \`tween()\`, \`chain()\`, \`all()\`, \`wait()\`

Compose multi-step animations declaratively:

\`\`\`js
import { tween, wait, hold, offset, chain, all, stagger, applyAt } from '@blahblah/sdk';

const shot = chain(
  tween({ from: 0, to: 120, duration: 0.6, ease: 'outCubic' }),
  wait(0.2),
  tween({ from: 0, to: 1, duration: 0.4 }),
);

onUpdate({ time }) {
  const [x, , opacity] = shot.valueAt(time);
}
\`\`\`

### \`memoizeByProps\` — cache only the expensive part

Rebuild heavy layouts only when structural props change, while tweens evaluate at 60fps:

\`\`\`js
import { memoizeByProps } from '@blahblah/sdk';

const layout = memoizeByProps((props) => buildGraph(props.nodes, props.edges), ['nodes', 'edges']);

onUpdate({ props, time }) {
  const graph = layout(props); // rebuilt only when nodes or edges change
  render(graph, time);
}
\`\`\`

---

## 4. \`canvas\` scripts — custom rendering (DOM/Canvas/WebGL)

For 2D canvas drawing, **always extend \`CanvasComponent\`** from \`@blahblah/sdk\`.

\`\`\`js
import { CanvasComponent } from '@blahblah/sdk';

export default class MyCanvasThing extends CanvasComponent {
  static props = { speed: num(1, { min: 0, max: 10 }) };

  onMount({ container, signal, props, canvasWidth, canvasHeight, aspect, tween, Tween, duration, totalFrames, progress, startTime, endTime, timeLeft, timelineTime }) {
    // container is sized in output pixels.
    // this.canvas, this.ctx, this.canvasWidth, this.canvasHeight, this.aspect are ready!
  }

  onUpdate({ container, time, frame, fps, props, tween, Tween, canvasWidth, canvasHeight, aspect, duration, totalFrames, progress, startTime, endTime, timeLeft, timelineTime }) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

    this.centerOrigin(); // (0, 0) is canvas center
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(0, 0, 40, 0, Math.PI * 2);
    ctx.fill();
    this.restoreOrigin();
  }

  onSeek({ container, time, frame, fps, props, tween, canvasWidth, canvasHeight }) {
    // Optional: playhead scrubbed past 2 frames; reset accumulated particle state
  }

  onUnmount({ container }) {
    super.onUnmount({ container });
  }
}
\`\`\`

### Container Sizing Rule

\`container\` is already sized in output pixels to match \`canvasWidth\` × \`canvasHeight\` (the project's output resolution) before \`onMount\` is called.
**Never set \`container.style.width\` or \`height\` to \`'100%'\`.**

### \`CanvasComponent\` Base Class & Center Origin \`(0, 0)\`

- **\`this.centerOrigin()\`**: Translates 2D origin to canvas center \`(canvasWidth / 2, canvasHeight / 2)\` after saving context. In this mode:
  - Center is \`(0, 0)\`
  - Left edge is \`-canvasWidth / 2\`, right edge is \`+canvasWidth / 2\`
  - Top edge is \`-canvasHeight / 2\`, bottom edge is \`+canvasHeight / 2\`
- **\`this.restoreOrigin()\`**: Restores context state saved by \`centerOrigin()\`.
- **\`this.toScreen(x, y)\`**: Converts center-relative coordinates to top-left screen pixel coordinates \`(x + width/2, y + height/2)\`.
- **\`this.fromScreen(screenX, screenY)\`**: Converts top-left screen pixel coordinates to center-relative coordinates.

### Batching Shapes & DOM/SVG Lists

- \`shapes.roundedRect(x, y, w, h, r)\`, \`shapes.pill(x, y, w, h)\`, \`shapes.diamond(cx, cy, w, h)\`, \`shapes.arrowPath(from, to, opts)\`
- \`shapes.drawRoundedRect(ctx, x, y, w, h, r)\`, \`shapes.drawArrow(ctx, from, to, opts)\`
- \`svgList(layer, data, keyFn, { tag, enter, update, exit })\`
- \`mergeManualOverrides(autoList, manualList, key, fields)\`

---

## 5. Script gizmos — interactive handles in preview

Scripts can expose interactive handles (gizmos) rendered directly on top of the preview viewport. Users can click, drag, multi-select, and configure these handles visually, with updates written automatically back to script \`props\` and timeline keyframes.

### Declaring Gizmos

#### Method A: Dynamic \`getGizmos()\` Hook (Recommended)

Implement \`getGizmos({ props, time, canvasWidth, canvasHeight })\` on your script class:

\`\`\`js
import { CanvasComponent } from '@blahblah/sdk';

const DEFAULT_NODES = [
  { id: 'start', label: 'Start', x: -150, y: 0 },
  { id: 'end', label: 'End', x: 150, y: 0 },
];

export default class InteractiveNodes extends CanvasComponent {
  static props = {
    nodes: {
      type: 'struct[]',
      label: 'Nodes',
      gizmo: true,
      default: DEFAULT_NODES,
      fields: {
        id: text(''),
        label: text(''),
        x: num(0, { min: -1920, max: 1920 }),
        y: num(0, { min: -1080, max: 1080 }),
      },
    },
  };

  getNodes(props) {
    return Array.isArray(props.nodes) && props.nodes.length > 0 ? props.nodes : DEFAULT_NODES;
  }

  getGizmos({ props, time, canvasWidth, canvasHeight }) {
    const nodes = this.getNodes(props);
    return nodes.map((node, index) => ({
      id: node.id || ('node-' + index),
      label: node.label || ('Node ' + (index + 1)),
      x: node.x ?? 0,
      y: node.y ?? 0,
      propPath: 'nodes[' + index + ']',
      axes: 'xy',
      space: 'local', // (0, 0) is canvas center
      color: '#38bdf8',
    }));
  }

  onUpdate({ props }) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    const nodes = this.getNodes(props);

    this.centerOrigin();

    if (nodes.length >= 2) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(nodes[0].x, nodes[0].y);
      ctx.lineTo(nodes[1].x, nodes[1].y);
      ctx.stroke();
    }

    nodes.forEach((node) => {
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.arc(node.x, node.y, 20, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '600 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.label || '', node.x, node.y + 4);
    });

    this.restoreOrigin();
  }
}
\`\`\`

#### Method B: Property Schema Annotation (\`gizmo: true\`)

Add \`gizmo: true\` to any \`struct\` with \`x\`/\`y\` or \`struct[]\` prop in \`static props\`:

\`\`\`js
static props = {
  targetPoint: {
    type: 'struct',
    gizmo: true,
    fields: { x: num(0), y: num(0) },
  },
  splitX: {
    type: 'number',
    default: 0,
    gizmo: { axis: 'x', size: 'compact' },
  },
  pins: {
    type: 'struct[]',
    gizmo: true,
    fields: { x: num(0), y: num(0) },
    default: [{ x: -100, y: -50 }, { x: 100, y: 50 }],
  },
};
\`\`\`

### \`ScriptGizmoDef\` Reference

| Field | Type | Default | Description |
|---|---|---|---|
| \`id\` | \`string\` | *(required)* | Unique identifier for the handle within the script |
| \`label\` | \`string\` | \`id\` | Label shown in viewport tooltips and HUD |
| \`x\` | \`number\` | \`0\` | X coordinate |
| \`y\` | \`number\` | \`0\` | Y coordinate |
| \`space\` | \`'local' \| 'global'\` | \`'local'\` | Coordinate space: \`'local'\` places \`(0, 0)\` at canvas center. \`'global'\` uses top-left canvas pixel coordinates. |
| \`axes\` | \`'xy' \| 'x' \| 'y'\` | \`'xy'\` | Drag axis constraint (\`'xy'\` = 2D free, \`'x'\` = horizontal only, \`'y'\` = vertical only) |
| \`rotation\` | \`number\` | \`0\` | Local rotation angle in degrees for orienting axis arrows |
| \`size\` | \`'compact' \| 'normal' \| 'large'\` | \`'normal'\` | Display size of the handle pin |
| \`color\` | \`string\` | \`'#38bdf8'\` | Accent color |
| \`shape\` | \`'circle' \| 'rect' \| 'diamond'\` | \`'circle'\` | Shape of the handle icon |
| \`propPath\` | \`string\` | - | Nested property path to write on drag (e.g. \`'targetPoint'\`, \`'pins[0]'\`) |
| \`onDrag\` | \`Function\` | - | Optional drag callback \`({ x, y, dx, dy })\` |
| \`contextMenu\` | \`Array<{ label, action }>\` | - | Custom right-click menu items |

### Viewport Interaction Features

- **Center Origin (0, 0)**: In default \`'local'\` space, \`(0, 0)\` is the canvas center. Switching resolution or aspect ratio preserves center alignments.
- **Selection Requirement**: Gizmos render when their entity is selected in the timeline or hierarchy.
- **Axis Snapping**: Dragging along axis arrows constrains motion; holding \`Shift\` snaps movement to the dominant axis.
- **Multi-Selection**: Hold \`Shift + Click\` or rubberband drag in empty preview space to select multiple gizmos.
- **Numerical HUD**: Displays live \`(X, Y)\`, delta \`(dx, dy)\`, and angle during drag.
- **Auto-Keying**: If Auto-Key is active or keyframes exist, dragging automatically inserts keyframes at current playhead time.

---

## 6. Reference props — \`entity\` and \`asset\` types

Props declared with \`{ type: 'entity' }\` or \`{ type: 'asset' }\` resolve to \`EntityRef\` or \`AssetRef\` instances before running your hooks:

### Filtering & Auto-Identification
- \`targetComponent: 'AudioSource'\`, \`'VideoRenderer'\`, \`'SubtitleTrack'\`
- \`assetType: 'audio'\`, \`'video'\`, \`'image'\`

### \`EntityRef\` (Reference to another timeline clip)

\`\`\`ts
declare class EntityRef {
  readonly id: string | null;
  readonly name: string | null;
  readonly startTime: number;   // seconds on timeline
  readonly duration: number;    // seconds
  readonly endTime: number;     // seconds (startTime + duration)
  readonly parentId: string | null;
  readonly trackId: string | null;
  readonly audioSrc: string | null;
  readonly audioDuration: number | null;
  exists(): boolean;
  getTransform(): { x, y, rotation, scaleX, scaleY, opacity, speed } | null;
  getComponent(type: string): object | null;

  // Audio Sync API:
  isPlayingAt(timelineTime: number): boolean;
  getAudioTime(time: number, isLocalTime?: boolean): number | null;
  getAudioProgress(time: number, isLocalTime?: boolean): number; // 0.0 -> 1.0 progress through clip
  getAudioSettings(): { volume, speed, effectiveSpeed, mediaOffset, muted, loop, src } | null;

  // Subtitle API:
  getPhraseAt(localTime: number): SubtitlePhraseContext | null; // time = entity local seconds
  getCurrentText(localTime: number): string;
}
\`\`\`

### Subtitle Integration with Whisper STT

Entities with a \`SubtitleTrack\` component provide word- and phrase-level timings (e.g. from the built-in Whisper auto-transcriber). Calling \`props.subtitleTrack?.getPhraseAt(time)\` returns:

\`\`\`ts
interface SubtitlePhraseContext {
  text: string;                 // Recommended display text (SET vs ADD aware)
  sentenceText: string;         // Accumulated text of current sentence group
  sentencePhrases: SubtitlePhrase[];
  accumulatedText: string;      // Full concatenated text from start of track
  accumulatedPhrases: SubtitlePhrase[];
  phrase: SubtitlePhrase | null;// Active phrase object (null during gaps)
  prev: SubtitlePhrase | null;
  next: SubtitlePhrase | null;
  index: number | null;
  mode: 'set' | 'add';
}
\`\`\`

Each \`SubtitlePhrase\` includes:
- \`text\`: The phrase text.
- \`mode\`: \`'set'\` (replaces previous text) or \`'add'\` (accumulates onto sentence).
- \`startTime\` / \`endTime\` / \`duration\`: Local timing.
- \`words\`: Word-level timing array \`[{ word: 'hello', start: 0.1, end: 0.4 }]\` for karaoke effects.
- \`emphasis\`: Boolean styling hint.

### \`AssetRef\` (Reference to a project media file)

\`\`\`ts
declare class AssetRef {
  readonly id: string | null;
  readonly name: string | null;
  readonly src: string | null;
  readonly type: 'video' | 'audio' | 'image' | null;
  readonly duration: number | null;
  readonly isPlaying: boolean;
  exists(): boolean;

  play(options?: { volume?: number, speed?: number, loop?: boolean, offset?: number }): HTMLAudioElement | null;
  playOneShot(options?: { volume?: number, speed?: number, offset?: number }): HTMLAudioElement | null;
  pause(): void;
  stop(): void;
}
\`\`\`

Use \`playOneShot()\` for sound effects, collisions, and user interactions without interrupting overlapping audio!

---

## 7. \`react\` scripts — custom React clip content

Export a functional component returning JSX or using \`h()\`:

\`\`\`jsx
export default function MyClip() {
  return (
    <div style={{ color: '#38bdf8', fontSize: '32px', fontWeight: 'bold' }}>
      Hello BlahBlah
    </div>
  );
}
\`\`\`

---

## 8. \`shader\` scripts — custom transitions

GLSL transition compatible with \`gl-transitions\`:

\`\`\`glsl
uniform float intensity; // = 1.0
uniform float scanlines; // = 20.0

vec4 transition(vec2 uv) {
  vec2 p = uv;
  vec4 fromColor = getFromColor(p);
  vec4 toColor = getToColor(p);
  return mix(fromColor, toColor, progress); // progress is 0.0 -> 1.0
}
\`\`\`

---

## 9. Real \`import\` statements (npm packages)

Import any npm package directly in your script:

\`\`\`js
import * as THREE from 'three';
import gsap from 'gsap';
import confetti from 'canvas-confetti';
import { sugiyama } from 'd3-dag';
import { helper } from './localHelper.js';
\`\`\`

Packages resolve automatically via esm.sh and are cached in IndexedDB for 100% offline usage.

---

## 10. Three.js 3D visual scripts — \`ThreeComponent\`

For Three.js scenes, **always extend \`ThreeComponent\`** from \`@blahblah/sdk\`:

\`\`\`js
import { ThreeComponent } from '@blahblah/sdk';
import * as THREE from 'three';

export default class SpinningCube extends ThreeComponent {
  static props = {
    boxColor: color('#f43f5e'),
    spinSpeed: num(1.0, { min: 0, max: 10 }),
  };

  onMount({ container, canvasWidth, canvasHeight, aspect }) {
    super.onMount({ container, canvasWidth, canvasHeight, aspect });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    this.camera.position.z = 5;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(canvasWidth, canvasHeight);
    container.appendChild(this.renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, 1.5);
    light.position.set(2, 4, 5);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    const geo = new THREE.BoxGeometry(2, 2, 2);
    this.mat = new THREE.MeshStandardMaterial({ color: '#f43f5e', roughness: 0.3 });
    this.cube = new THREE.Mesh(geo, this.mat);
    this.scene.add(this.cube);
  }

  onUpdate({ time, props }) {
    super.onUpdate({ props });
    if (!this.renderer || !this.scene || !this.camera) return;

    this.mat.color.set(props.boxColor);
    this.cube.rotation.x = time * props.spinSpeed * 0.8;
    this.cube.rotation.y = time * props.spinSpeed;

    this.renderer.render(this.scene, this.camera);
  }

  onUnmount({ container }) {
    super.onUnmount({ container });
    this.cube?.geometry?.dispose();
    this.mat?.dispose();
  }
}
\`\`\`

---

## 11. Full Working Examples

### Example 1: 2D Arrow Callout with Typography & Center Origin

\`\`\`js
import { CanvasComponent } from '@blahblah/sdk';

export default class ArrowCallout extends CanvasComponent {
  static props = {
    label: text('NEW: Feature', { label: 'Callout Text', tab: 'Content' }),
    targetX: num(0, { min: -900, max: 900, label: 'X', tab: 'Layout', box: 'Arrow Target', inline: true }),
    targetY: num(0, { min: -500, max: 500, label: 'Y', tab: 'Layout', box: 'Arrow Target', inline: true }),
    labelX: num(0, { min: -900, max: 900, label: 'X', tab: 'Layout', box: 'Label Position', inline: true }),
    labelY: num(-150, { min: -500, max: 500, label: 'Y', tab: 'Layout', box: 'Label Position', inline: true }),
    accentColor: color('#a3e635', { label: 'Accent Color', tab: 'Style', box: 'Colors', inline: true }),
    textColor: color('#ffffff', { label: 'Text Color', tab: 'Style', box: 'Colors', inline: true }),
    fontFamily: font('Inter', { label: 'Font', tab: 'Style', box: 'Typography' }),
  };

  onUpdate({ time, props }) {
    const { ctx, canvasWidth, canvasHeight } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    this.centerOrigin();

    const enter = Math.min(1, time * 5);
    const pop = 0.88 + Math.sin(enter * Math.PI * 0.5) * 0.12;

    ctx.save();
    ctx.globalAlpha = enter;

    // Draw line connecting label to target
    ctx.strokeStyle = props.accentColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(props.labelX, props.labelY);
    ctx.lineTo(props.targetX, props.targetY);
    ctx.stroke();

    // Target indicator ring
    ctx.strokeStyle = props.accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(props.targetX, props.targetY, 14, 0, Math.PI * 2);
    ctx.stroke();

    // Label card with typography
    ctx.translate(props.labelX, props.labelY);
    ctx.scale(pop, pop);
    ctx.font = \`800 22px "\${props.fontFamily}", sans-serif\`;
    const textW = ctx.measureText(props.label).width;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-textW / 2 - 16, -20, textW + 32, 40);

    ctx.fillStyle = props.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(props.label, 0, 0);

    ctx.restore();
    this.restoreOrigin();
  }
}
\`\`\`

### Example 2: Interactive Constellation Graph (With Gizmos)

\`\`\`js
import { CanvasComponent } from '@blahblah/sdk';

const DEFAULT_STARS = [
  { x: -200, y: -100, radius: 12, color: '#facc15' },
  { x:    0, y:   50, radius: 16, color: '#38bdf8' },
  { x:  200, y: -100, radius: 14, color: '#ec4899' },
];

export default class ConstellationGraph extends CanvasComponent {
  static props = {
    lineColor: color('#38bdf8'),
    stars: {
      type: 'struct[]',
      label: 'Stars',
      gizmo: true,
      default: DEFAULT_STARS,
      fields: {
        x: num(0, { min: -1920, max: 1920 }),
        y: num(0, { min: -1080, max: 1080 }),
        radius: num(12, { min: 4, max: 50 }),
        color: color('#ffffff'),
      },
    },
  };

  getStars(props) {
    return Array.isArray(props.stars) && props.stars.length > 0 ? props.stars : DEFAULT_STARS;
  }

  getGizmos({ props }) {
    const list = this.getStars(props);
    return list.map((star, i) => ({
      id: 'star-' + i,
      label: 'Star ' + (i + 1),
      x: star.x,
      y: star.y,
      propPath: 'stars[' + i + ']',
      axes: 'xy',
      space: 'local',
      color: star.color || '#38bdf8',
    }));
  }

  onUpdate({ time, props }) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

    const stars = this.getStars(props);
    this.centerOrigin();

    ctx.strokeStyle = props.lineColor || '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        ctx.moveTo(stars[i].x, stars[i].y);
        ctx.lineTo(stars[j].x, stars[j].y);
      }
    }
    ctx.stroke();

    stars.forEach((star, idx) => {
      const pulse = Math.sin(time * 3 + idx) * 3;
      const r = Math.max(2, (star.radius || 12) + pulse);

      ctx.save();
      ctx.fillStyle = star.color || '#ffffff';
      ctx.shadowColor = star.color || '#ffffff';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(star.x, star.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    this.restoreOrigin();
  }
}
\`\`\`

### Example 3: Subtitle-Driven Kinetic Text Overlay

\`\`\`js
import { CanvasComponent } from '@blahblah/sdk';

export default class KineticCaptions extends CanvasComponent {
  static props = {
    subtitleSource: entity({ targetComponent: 'SubtitleTrack', label: 'Subtitle Track' }),
    textColor: color('#ffffff', { label: 'Text Color' }),
    accentColor: color('#facc15', { label: 'Accent Color' }),
    fontFamily: font('Inter', { label: 'Font' }),
  };

  onUpdate({ time, props }) {
    const { ctx, canvasWidth, canvasHeight } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const sub = props.subtitleSource?.getPhraseAt(time);
    if (!sub || !sub.text) return;

    this.centerOrigin();

    ctx.font = \`800 \${canvasHeight * 0.06}px "\${props.fontFamily}", sans-serif\`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Highlight current word if Whisper word timings exist
    const phrase = sub.phrase;
    const words = phrase?.words;
    if (words && words.length > 0) {
      const phraseLocalTime = time - (phrase.startTime || 0);
      const activeWord = words.find((w) => phraseLocalTime >= w.start && phraseLocalTime <= w.end);
      ctx.fillStyle = activeWord ? props.accentColor : props.textColor;
    } else {
      ctx.fillStyle = props.textColor;
    }

    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 16;
    ctx.fillText(sub.text, 0, canvasHeight * 0.35);

    this.restoreOrigin();
  }
}
\`\`\`

### Example 4: Audio-Synced Pulse Visualizer

\`\`\`js
import { CanvasComponent } from '@blahblah/sdk';

export default class AudioPulse extends CanvasComponent {
  static props = {
    music: entity({ targetComponent: 'AudioSource', label: 'Music Track' }),
    baseColor: color('#22c55e', { label: 'Color' }),
  };

  onUpdate({ timelineTime, props }) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

    const audio = props.music;
    let scaleMultiplier = 1.0;

    if (audio?.exists() && audio.isPlayingAt(timelineTime)) {
      const progress = audio.getAudioProgress(timelineTime);
      scaleMultiplier = 1.0 + Math.sin(progress * Math.PI * 64) * 0.3;
    }

    this.centerOrigin();
    ctx.fillStyle = props.baseColor || '#22c55e';
    ctx.beginPath();
    ctx.arc(0, 0, 80 * scaleMultiplier, 0, Math.PI * 2);
    ctx.fill();
    this.restoreOrigin();
  }
}
\`\`\`

### Example 5: Transform Motion Script (Pop & Float)

\`\`\`js
export default class PopAndFloat {
  static props = {
    floatSpeed: num(2.0, { min: 0.1, max: 10 }),
    floatAmount: num(20, { min: 0, max: 100 }),
  };

  onStart({ transform, tween }) {
    tween.punch(transform.scale, { x: 0.3, y: 0.3 }, { duration: 0.8, vibrato: 8 });
  }

  onUpdate({ transform, time, props }) {
    const yOffset = Math.sin(time * props.floatSpeed) * props.floatAmount;
    transform.position.y += yOffset;
    transform.rotation = Math.sin(time * props.floatSpeed * 0.5) * 4;
  }
}
\`\`\`

---

## Quick-reference cheat sheet

\`\`\`
MOTION   → class, onStart/onUpdate({ transform, tween, props, time, ... })
CANVAS   → class extends CanvasComponent, onMount/onUpdate/onUnmount({ container, props, canvasWidth, canvasHeight, ... })
THREE    → class extends ThreeComponent, onMount/onUpdate/onUnmount({ container, scene, camera, renderer, ... })
REACT    → function returning JSX (or h(tag, props, children))
SHADER   → GLSL: uniform ...; vec4 transition(vec2 uv) { ... getFromColor/getToColor/progress ... }

static props = {
  speed: num(1.0, { min: 0, max: 10, unit: 's' }),
  active: bool(true, { controls: 'Motion' }),
  tint: color('#ffffff'),
  title: text('Hello', { multiline: false }),
  font: font('Inter'),
  mode: select('a', ['a', 'b'], { selectButton: true }),
  audio: entity({ targetComponent: 'AudioSource' }),
  sub: entity({ targetComponent: 'SubtitleTrack' }),
  sfx: asset('audio'),
  btn: button('bake'),
  ...Presets.timing, ...Presets.typography, ...Presets.colors, ...Presets.audioFx,
  list: { type: 'struct[]', gizmo: true, fields: { x: num(0), y: num(0) } }
};

getGizmos({ props, time, canvasWidth, canvasHeight }) → [ { id, label, x, y, space: 'local'|'global', axes: 'xy'|'x'|'y', propPath } ]
CanvasComponent: toScreen(x, y), fromScreen(x, y), centerOrigin(), restoreOrigin()

tween.to/from/spring/punch/shake/sine(target, props, options)  // motion onStart only
Tween.progress/between/loop/pingPong/stagger/ease/lerp/remap    // generic, all script kinds
Easing.<name> / Ease.<Name>
MathUtils.lerp/clamp/clamp01/remap/degToRad/radToDeg/vec2/vec3/bezierPointAt/bezierTangentAt
interpolate(value, [in...], [out...], opts)
spring({ frame, fps, config })

tween({ from, to, duration, delay, ease, loop, yoyo })  // one value as a sequence node
chain / all / wait / hold / offset / stagger / applyAt  // seekable sequence composition
memoizeByProps(fn, ['keys'])                            // rebuild only when those props change
shapes.roundedRect/pill/diamond/arrowPath               // SVG path strings
shapes.drawRoundedRect/drawArrow(ctx, ...)              // Canvas2D
svgList(layer, data, keyFn, { enter, update, exit })    // d3-style DOM/SVG list
mergeManualOverrides(auto, manual, key, fields)         // auto + human-edited list

EntityRef:  id, name, startTime, duration, endTime, parentId, trackId, audioSrc, audioDuration, exists(), getTransform(), getComponent(type), isPlayingAt(t), getAudioTime(t), getAudioProgress(t), getAudioSettings(), getPhraseAt(time), getCurrentText(time)
AssetRef:   id, name, src, type, duration, isPlaying, exists(), play(opts), playOneShot(opts), pause(), stop()

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
   * at something.
   */
  const menu = useMemo(() => {
    const headings = listHeadings(SCRIPT_API_DOCS_MARKDOWN);
    return SECTIONS.map((section) => {
      const needle = section.match.toLowerCase();
      const heading = headings.find((h) => h.text.toLowerCase().includes(needle));
      return heading ? { ...section, headingId: heading.id } : null;
    }).filter(Boolean);
  }, []);

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

  /** Scroll the content pane to a section. */
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
 * Minimal, dependency-free Markdown -> JSX renderer covering what
 * SCRIPT_API_DOCS_MARKDOWN uses (headings, fenced code blocks, tables,
 * callouts/blockquotes, ordered & unordered lists, bold, italic, inline code,
 * horizontal rules, links).
 */
function DocsMarkdown({ text, depth = 0 }) {
  if (!text) return null;
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

    // Callout / Blockquote: lines starting with '>'
    if (line.trim().startsWith('>')) {
      const bqLines = [];
      while (i < lines.length && (lines[i].trim().startsWith('>') || (bqLines.length > 0 && lines[i].trim() === ''))) {
        if (lines[i].trim().startsWith('>')) {
          bqLines.push(lines[i].trim().replace(/^>\s?/, ''));
        } else {
          // Check if blockquote continues after empty lines
          let nextIdx = i + 1;
          while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;
          if (nextIdx < lines.length && lines[nextIdx].trim().startsWith('>')) {
            bqLines.push('');
          } else {
            break;
          }
        }
        i++;
      }
      if (depth <= 2) {
        blocks.push(
          <div key={key++} className="docs-callout">
            <DocsMarkdown text={bqLines.join('\n')} depth={depth + 1} />
          </div>
        );
      }
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

    // Unordered bullet list
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

    // Ordered numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const itemLines = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        itemLines.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={key++} className="docs-list docs-list-ordered">
          {itemLines.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('#') &&
      !lines[i].trim().startsWith('>') &&
      lines[i].trim() !== '---' &&
      !lines[i].trim().startsWith('|') &&
      !/^\s*-\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
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

function renderInline(str) {
  if (!str) return null;
  const parts = str.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={idx}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a key={idx} href={linkMatch[2]} target="_blank" rel="noreferrer" className="docs-link">
          {linkMatch[1]}
        </a>
      );
    }
    return part;
  });
}
