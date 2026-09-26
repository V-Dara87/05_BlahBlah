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

This document is the authoritative reference for writing user scripts (\`ScriptComponent\`)
in the BlahBlah timeline editor.

> **CRITICAL INSTRUCTIONS FOR AI CODE GENERATORS:**
> When asked to generate a BlahBlah script, follow these rules strictly to avoid runtime errors:
> 1. **Pick Exactly One Contract**: Choose \`canvas\`, \`motion\`, \`react\`, or \`shader\`. Never mix methods from different contracts.
> 2. **For 2D Canvas Graphics**: Always \`import { CanvasComponent } from '@blahblah/sdk';\` and extend it. It automatically creates the \`<canvas>\`, tracks resolution, provides \`this.ctx\`, \`this.centerOrigin()\`, \`this.restoreOrigin()\`, and \`this.toScreen()\`.
> 3. **For 3D Graphics**: Always \`import { ThreeComponent } from '@blahblah/sdk';\` and \`import * as THREE from 'three';\`. It automatically manages the WebGL renderer, perspective camera aspect ratio, and disposal.
> 4. **Container Sizing**: NEVER set \`container.style.width\` or \`container.style.height\` to \`'100%'\`. The container is already sized in project output pixels.
> 5. **Deterministic Animations**: \`onUpdate\` must be a pure function of \`time\` (local seconds) or \`frame\`. Never accumulate wall-clock deltas (\`this.x += 1\`) without handling \`onSeek\`.
> 6. **Prop Helpers**: Use \`num()\`, \`bool()\`, \`color()\`, \`text()\`, \`select()\`, \`asset()\`, \`entity()\`, \`font()\`, \`button()\`, \`group()\`, \`row()\`, and \`Presets\`. They are injected globally into script scope (no import needed).
> 7. **Interactive Gizmos**: Implement \`getGizmos({ props, canvasWidth, canvasHeight })\` or add \`gizmo: true\` to props. In default \`space: 'local'\`, \`(0, 0)\` is the canvas center.
> 8. **Reference Props**: When using \`type: 'entity'\` or \`type: 'asset'\`, props resolve to \`EntityRef\` or \`AssetRef\` instances with helper methods like \`getTransform()\`, \`getAudioProgress(time)\`, and \`playOneShot()\`. Always check \`prop?.exists()\`.

---

## Rules for AI Code Generators

Before writing any script code, review this checklist:

| Task | Correct Pattern | Incorrect Pattern (Do NOT do this) |
|---|---|---|
| **2D Canvas script** | \`class MyScript extends CanvasComponent\` | Hand-rolling raw \`<canvas>\` without handling resize or container cleanup |
| **Canvas Center Origin** | \`this.centerOrigin(); /* draw at (0,0) */; this.restoreOrigin();\` | Hardcoding \`canvasWidth / 2\` on every single coordinate call |
| **3D Three.js script** | \`class MyScene extends ThreeComponent\` | Creating \`WebGLRenderer\` manually without resizing or cleanup on unmount |
| **Motion script** | Class with \`onStart({ transform, tween })\` / \`onUpdate({ transform, time })\` | Extending \`CanvasComponent\` for transform animation, or returning JSX |
| **Props declaration** | \`static props = { speed: num(1.5, { min: 0, max: 10 }) };\` | Using plain TypeScript interfaces without \`static props\` runtime object |
| **Array & struct defaults** | \`const items = props.items?.length ? props.items : DEFAULT_ITEMS;\` | \`const items = props.items \|\| [];\` (when unedited, \`props.items\` is undefined, so \`\|\| []\` leaves array empty and draws 0 items!) |
| **Gizmo property naming** | Name position fields \`x\` and \`y\` in your struct: \`{ x: num(0), y: num(0) }\` | Naming them \`xOffset\`, \`posX\`, etc. (\`updateGizmoProperty\` explicitly writes to \`.x\` and \`.y\` on drag) |
| **Gizmo visibility** | Select the clip in the timeline/hierarchy to show handles in preview | Expecting gizmos to show on unselected clips (gizmos only render when \`isSelected === true\`) |
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
- JSX and TypeScript syntax (transpiled automatically in-browser).

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

\`opts\` is just the field's other keys. \`opts.unit\` appends a unit to the auto-generated label (\`unit: 'px'\` → "Radius (px)"); an explicit \`opts.label\` wins. The label itself is derived from the key you assign the field to, so \`startDelay\` becomes "Start Delay" with no \`label\` to type.

Shorthand values are still accepted in place of a helper — the type is inferred:
\`\`\`js
static props = { speed: 2.5, color: '#ff0000', label: 'hello' };
\`\`\`

Field \`type\` values: \`number\`, \`color\`, \`boolean\`, \`select\`, \`string\`, \`textarea\`, \`font\`, \`entity\`, \`asset\`, \`struct\`, \`struct[]\`, \`button\`, as well as primitive and reference arrays: \`string[]\`, \`number[]\`, \`color[]\`, \`boolean[]\`, \`select[]\`, \`asset[]\`, \`entity[]\` (or \`type: 'array', itemType: '...'\`).

\`font\` renders the searchable Font Family picker (installed PC fonts + Google fonts). The script receives a plain family-name string like \`'Inter'\`. It is not keyframeable. Apply it in CSS with:
\`el.style.fontFamily = '"' + props.fontFamily + '", system-ui, sans-serif'\`.

### Primitive and Reference Arrays (\`string[]\`, \`number[]\`, \`asset[]\`, \`entity[]\`)
Declare primitive or reference arrays to expose a reorderable list:
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
// props.images -> [AssetRef, AssetRef]
// props.targets -> [EntityRef, EntityRef]
\`\`\`

### Structs and Struct Arrays (\`struct\`, \`struct[]\`)
\`struct\` groups several fields into one object; \`struct[]\` is an editable list of objects. Both take a \`fields\` sub-schema:
\`\`\`js
static props = {
  title: { type: 'struct', label: 'Title', fields: {
    text:  { type: 'string', default: 'Hello' },
    color: { type: 'color',  default: '#ffffff' },
  }},
  items: { type: 'struct[]', label: 'Items', gizmo: true, fields: {
    label: { type: 'string', default: '' },
    size:  { type: 'number', default: 1 },
    x:     num(0, { min: -1920, max: 1920 }),
    y:     num(0, { min: -1080, max: 1080 }),
  }},
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
| \`box: 'Name'\` | A titled box around its members |
| \`foldout: 'Name'\` | Collapsible box panel |
| \`tab: 'Name'\` | Places fields inside the named tab |
| \`inline: true\` | Shares one row with adjacent inline fields |
| \`title: 'Heading'\` | Section header row above this field |
| \`space: true\` or \`space: 12\` | Vertical space above this field |

### Condition Attributes
| Attribute | Effect |
| --- | --- |
| \`showIf: 'enabled'\` | Draw the field only while the expression is truthy |
| \`hideIf: 'locked'\` | Draw the field only while the expression is falsy |
| \`enableIf: 'enabled && speed > 2'\` | Draw it, but greyed out and uneditable unless true |
| \`disableIf: 'locked'\` | The inverse of \`enableIf\` |

### Controls
| Attribute | Effect |
| --- | --- |
| \`toggleLeft: true\` | Checkbox first, label after it |
| \`selectButton: true\` | Render a \`select\` as a strip of buttons instead of a dropdown |
| \`controls: 'Name'\` | On a boolean: switches the group named \`Name\`, dimming members when off |
| \`button: 'method'\` | Small action button next to the field |
| \`button: { label: 'Bake', action: 'bake', variant: 'primary' }\` | With label and styling (\`primary\` / \`danger\`) |

### Action Buttons
A field of \`{ type: 'button' }\` renders a full-width button calling \`action\`:
\`\`\`js
bake({ props, set, setAll, refresh, entity, entityId, scriptId, time, frame, fps, duration }) {
  set('speed', 2.0); // update single prop
  setAll({ amplitude: 50, frequency: 1 }); // update multiple props
}
\`\`\`

---

## 3. \`motion\` scripts — animating a clip's transform

Motion scripts procedural animate an entity's position, rotation, scale, and opacity:

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
| \`tween.between(from, to, time, options)\` | A numeric value between \`from\` and \`to\` |
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
\`\`\`js
const layout = memoizeByProps((props) => buildGraph(props.nodes, props.edges), ['nodes', 'edges']);

onUpdate({ props, time }) {
  const graph = layout(props); // rebuilt only when nodes / edges change
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
    // container is sized in pixels to match canvasWidth x canvasHeight.
    // this.canvas, this.ctx, this.canvasWidth, this.canvasHeight, this.aspect are initialized by base class!
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

### Container sizing — do not override with \`%\`
\`container\` is already sized in pixels to match \`canvasWidth\` × \`canvasHeight\` (the project's output resolution) before \`onMount\` is called.
**Never set \`container.style.width\`/\`height\` to \`'100%'\`.** Doing so overrides the intrinsic size with something relative to the DOM parent instead.

### \`CanvasComponent\` base class & center origin \`(0, 0)\`
- **\`this.centerOrigin()\`**: Translates origin to \`(canvasWidth / 2, canvasHeight / 2)\` after \`ctx.save()\`. Local \`x\` is \`-width/2\` to \`+width/2\`; \`y\` is \`-height/2\` to \`+height/2\`.
- **\`this.restoreOrigin()\`**: Calls \`ctx.restore()\`.
- **\`this.toScreen(x, y)\`**: Converts center-relative coordinates to screen pixel coordinates \`(x + width/2, y + height/2)\`.
- **\`this.fromScreen(screenX, screenY)\`**: Converts screen pixel coordinates to center-relative coordinates.

### Batching shapes & DOM/SVG lists
- \`shapes.roundedRect(x, y, w, h, r)\`, \`shapes.pill(x, y, w, h)\`, \`shapes.diamond(cx, cy, w, h)\`, \`shapes.arrowPath(from, to, opts)\`
- \`shapes.drawRoundedRect(ctx, x, y, w, h, r)\`, \`shapes.drawArrow(ctx, from, to, opts)\`
- \`svgList(layer, data, keyFn, { tag, enter, update, exit })\`
- \`mergeManualOverrides(autoList, manualList, key, fields)\`

---

## 5. Script gizmos — interactive handles in preview

Scripts can expose interactive handles (gizmos) rendered directly on top of the preview viewport. Users can click, drag, multi-select, and configure these handles visually, with updates written automatically back to script \`props\` and timeline keyframes.

### Declaring gizmos

#### Method A: Dynamic \`getGizmos()\` hook (Recommended)
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
      contextMenu: [
        { label: 'Reset Position', action: (gizmo) => { node.x = 0; node.y = 0; } },
      ],
    }));
  }

  onUpdate({ props }) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    const nodes = this.getNodes(props);

    this.centerOrigin();

    // Draw connecting line between nodes
    if (nodes.length >= 2) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(nodes[0].x, nodes[0].y);
      ctx.lineTo(nodes[1].x, nodes[1].y);
      ctx.stroke();
    }

    // Draw node circles
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

#### Method B: Property schema annotation (\`gizmo: true\`)
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

### \`ScriptGizmoDef\` reference

| Field | Type | Default | Description |
|---|---|---|---|
| \`id\` | \`string\` | *(required)* | Unique identifier for the handle within the script |
| \`label\` | \`string\` | \`id\` | Label shown in viewport tooltips and HUD |
| \`x\` | \`number\` | \`0\` | X coordinate |
| \`y\` | \`number\` | \`0\` | Y coordinate |
| \`space\` | \`'local' | 'global'\` | \`'local'\` | **Coordinate space**: \`'local'\` places \`(0, 0)\` at canvas center. \`'global'\` uses top-left canvas pixel coordinates \`[0..width, 0..height]\`. |
| \`axes\` | \`'xy' | 'x' | 'y'\` | \`'xy'\` | Drag axis constraint |
| \`rotation\` | \`number\` | \`0\` | Local rotation angle in degrees |
| \`size\` | \`'compact' | 'normal' | 'large'\` | \`'normal'\` | Display scale of the handle |
| \`color\` | \`string\` | \`'#38bdf8'\` | Accent color |
| \`shape\` | \`'circle' | 'rect' | 'diamond'\` | \`'circle'\` | Shape of the handle |
| \`propPath\` | \`string\` | - | Nested property path to update on drag (e.g. \`'pins[0]'\`, \`'targetPoint'\`) |
| \`onDrag\` | \`Function\` | - | Optional drag callback \`({ x, y, dx, dy })\` |
| \`contextMenu\` | \`Array<{ label, action }>\` | - | Custom right-click menu items |

### Viewport interaction features
- **Center origin (0, 0)**: In default \`'local'\` space, \`(0, 0)\` is the canvas center.
- **Axis snapping**: Dragging axis arrows constrains motion; Shift snaps to dominant axis.
- **Multi-select**: Shift + Click or rubberband marquee drag.
- **Numerical HUD**: Displays \`(X, Y)\`, \`(dx, dy)\`, and angle live during drag.
- **Auto-keying**: Records keyframes on drag if Auto-Key or keyframes exist.

---

## 6. Reference props — \`entity\` and \`asset\` types

Props declared with \`{ type: 'entity' }\` or \`{ type: 'asset' }\` resolve to \`EntityRef\` or \`AssetRef\` instances before running your hooks:

### Filtering & Auto-Identification
- \`targetComponent: 'AudioSource'\`, \`'VideoRenderer'\`, \`'SubtitleTrack'\`
- \`assetType: 'audio'\`, \`'video'\`, \`'image'\`

### \`EntityRef\` (reference to another clip)
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
  getPhraseAt(time: number): SubtitlePhraseContext | null; // time = local seconds
  getCurrentText(time: number): string;
}
\`\`\`

### Audio Synchronization Example
\`\`\`js
export default class AudioSyncedVisualizer extends CanvasComponent {
  static props = {
    audioTrack: entity({ targetComponent: 'AudioSource', label: 'Audio Clip' }),
  };

  onUpdate({ timelineTime, props }) {
    const audio = props.audioTrack;
    if (audio?.isPlayingAt(timelineTime)) {
      const audioTime = audio.getAudioTime(timelineTime);
      const progress = audio.getAudioProgress(timelineTime);
      // Drive animation based on audio progress
    }
  }
}
\`\`\`

### \`SubtitlePhraseContext\` (returned by \`getPhraseAt\`)
\`\`\`ts
{
  text: string;
  sentenceText: string;
  sentencePhrases: SubtitlePhrase[];
  accumulatedText: string;
  accumulatedPhrases: SubtitlePhrase[];
  index: number | null;
  phrase: SubtitlePhrase | null;
  prev: SubtitlePhrase | null;
  next: SubtitlePhrase | null;
}
\`\`\`

### \`AssetRef\` (reference to a media asset)
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

### Audio Firing / Sound Effects Example
\`\`\`js
export default class SoundEffectTrigger extends CanvasComponent {
  static props = {
    hitSfx: asset('audio', { label: 'Hit SFX' }),
  };

  onUpdate({ frame, props }) {
    if (frame === 15) {
      props.hitSfx?.playOneShot({ volume: 0.8, speed: 1.2 });
    }
  }
}
\`\`\`

---

## 7. \`react\` scripts — custom React clip content

Export a functional component returning JSX or using \`h()\`:
\`\`\`jsx
export default function MyClip() {
  return <div style={{ color: '#38bdf8', fontSize: '32px' }}>Hello BlahBlah</div>;
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

Import any npm package directly:
\`\`\`js
import * as THREE from 'three';
import gsap from 'gsap';
import { sugiyama } from 'd3-dag';
import { helper } from './localHelper.js';
\`\`\`
- Packages resolve via esm.sh and are cached in IndexedDB for 100% offline usage.

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

### Example 1: Interactive 2D Canvas Star Constellation (With Gizmos)
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

### Example 2: Transform Motion Script (Punch & Spring Floating)
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

### Example 3: Three.js 3D Torus Knot
\`\`\`js
import { ThreeComponent } from '@blahblah/sdk';
import * as THREE from 'three';

export default class TorusScene extends ThreeComponent {
  static props = {
    color: color('#a855f7', { label: 'Torus Color' }),
    speed: num(1.0, { min: 0, max: 5 }),
  };

  onMount({ container, canvasWidth, canvasHeight, aspect }) {
    super.onMount({ container, canvasWidth, canvasHeight, aspect });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
    this.camera.position.z = 8;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(canvasWidth, canvasHeight);
    container.appendChild(this.renderer.domElement);

    const light = new THREE.PointLight(0xffffff, 2, 50);
    light.position.set(5, 5, 8);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const geo = new THREE.TorusKnotGeometry(1.8, 0.5, 100, 16);
    this.mat = new THREE.MeshStandardMaterial({ color: '#a855f7', roughness: 0.2, metalness: 0.8 });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.scene.add(this.mesh);
  }

  onUpdate({ time, props }) {
    super.onUpdate({ props });
    if (!this.renderer || !this.mesh) return;

    this.mat.color.set(props.color);
    this.mesh.rotation.x = time * props.speed * 0.6;
    this.mesh.rotation.y = time * props.speed * 0.9;
    this.renderer.render(this.scene, this.camera);
  }

  onUnmount({ container }) {
    super.onUnmount({ container });
    this.mesh?.geometry?.dispose();
    this.mat?.dispose();
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

---

## Quick-reference cheat sheet

\`\`\`
MOTION   → class, onStart/onUpdate({ transform, tween, props, time, ... })
CANVAS   → class extends CanvasComponent, onMount/onUpdate/onUnmount({ container, props, canvasWidth, canvasHeight, ... })
THREE    → class extends ThreeComponent, onMount/onUpdate/onUnmount({ container, scene, camera, renderer, ... })
REACT    → function returning JSX (or h(tag, props, children))
SHADER   → GLSL: uniform ...; vec4 transition(vec2 uv) { ... getFromColor/getToColor/progress ... }

static props = { name: num(val, opts) | bool(val, opts) | color(val, opts) | text(str, opts) | select(val, opts) | font(f, opts) | entity(opts) | asset(type, opts) | button(act, opts) | struct | struct[] };

getGizmos({ props, time, canvasWidth, canvasHeight }) → [ { id, label, x, y, space: 'local'|'global', axes: 'xy'|'x'|'y', propPath } ]
CanvasComponent: toScreen(x, y), fromScreen(x, y), centerOrigin(ctx), restoreOrigin(ctx)

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
 * Minimal, dependency-free Markdown -> JSX renderer covering just what
 * SCRIPT_API_DOCS_MARKDOWN actually uses (headings, fenced code blocks,
 * tables, bold, inline code, horizontal rules, bullet lists).
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
