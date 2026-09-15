# blah-blah

Browser-based tutorial overlay editor — timeline + Inspector + code-driven motion (Remotion-style) on video.

## Docs (repo root)

- **[ARCHITECTURE.md](../ARCHITECTURE.md)** — strategy, strengths/weaknesses, phases, Tauri, external IDE, render pipeline
- **[roadmap.md](../roadmap.md)** — feature checklist and known flaws

## Develop

```bash
npm install
npm run dev
```

Requires a Chromium browser with File System Access API (Chrome, Edge, Brave) for on-disk projects.

## Project layout (on disk)

```
my-project/
  project.json
  scripts/       # edit here or in VS Code / Cursor
  prefabs/
  media/
```

---

## `@blahblah/sdk` — Script API Reference

Import from `@blahblah/sdk` inside any canvas script. Full TypeScript types are in [`packages/blahblah-sdk/index.d.ts`](./packages/blahblah-sdk/index.d.ts).

---

### Base Classes

#### `MotionScript`

Bare base class. All lifecycle methods are optional.

```js
import { MotionScript } from '@blahblah/sdk';

export default class MyScript extends MotionScript {
  static props = {
    color: { type: 'color', default: '#ffffff' },
  };

  onMount({ container, canvasWidth, canvasHeight, props }) { }
  onUpdate({ time, props }) { }
  onSeek({ time }) { }
  onUnmount({ container }) { }
}
```

---

#### `CanvasComponent`

Auto-creates and sizes a `<canvas>` element inside `container`. Handles resize in `onUpdate`, removes on unmount.

| Property | Type | Description |
|---|---|---|
| `canvas` | `HTMLCanvasElement` | The managed canvas element |
| `ctx` | `CanvasRenderingContext2D` | 2D drawing context |
| `canvasWidth` | `number` | Current canvas width in px |
| `canvasHeight` | `number` | Current canvas height in px |
| `aspect` | `number` | `canvasWidth / canvasHeight` |

```js
import { CanvasComponent } from '@blahblah/sdk';

export default class MyCanvas extends CanvasComponent {
  onMount({ props }) {
    // this.canvas, this.ctx, this.canvasWidth, this.canvasHeight are ready
  }
  onUpdate({ time }) {
    const { ctx, canvasWidth, canvasHeight } = this;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    // draw...
  }
}
```

---

#### `ThreeComponent`

Auto-creates a Three.js `Scene`, `PerspectiveCamera`, and `WebGLRenderer`. Handles DOM attachment, resize, and disposal.

| Property | Type | Description |
|---|---|---|
| `scene` | `THREE.Scene` | Three.js scene |
| `camera` | `THREE.PerspectiveCamera` | Perspective camera |
| `renderer` | `THREE.WebGLRenderer` | WebGL renderer (alpha enabled) |
| `canvasWidth` | `number` | Current canvas width in px |
| `canvasHeight` | `number` | Current canvas height in px |
| `aspect` | `number` | `canvasWidth / canvasHeight` |
| `autoResize` | `boolean` | Set `false` to opt-out of auto-resize |

```js
import { ThreeComponent } from '@blahblah/sdk';
import * as THREE from 'three';

export default class MyThree extends ThreeComponent {
  onMount({ signal }) {
    const geo = new THREE.BoxGeometry();
    const mat = new THREE.MeshNormalMaterial();
    this.mesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.mesh);
  }
  onUpdate({ time }) {
    this.mesh.rotation.y = time;
    this.renderer.render(this.scene, this.camera);
  }
}
```

---

### Lifecycle Args

All args are also assigned as instance properties by `canvasRunner.js` — so `this.canvasWidth`, `this.canvasHeight`, `this.aspect` are always current.

| Arg | Available in | Description |
|---|---|---|
| `container` | `onMount`, `onUpdate`, `onSeek`, `onUnmount` | Host DOM element |
| `canvasWidth` | `onMount`, `onUpdate`, `onSeek` | Effective canvas width (px) |
| `canvasHeight` | `onMount`, `onUpdate`, `onSeek` | Effective canvas height (px) |
| `aspect` | `onMount`, `onUpdate`, `onSeek` | `canvasWidth / canvasHeight` |
| `props` | `onMount`, `onUpdate`, `onSeek` | Resolved Inspector prop values |
| `time` | `onUpdate`, `onSeek` | Local clip time in seconds |
| `frame` | `onUpdate`, `onSeek` | Current frame number |
| `fps` | `onUpdate`, `onSeek` | Project frames-per-second |
| `duration` | all | Clip duration in seconds |
| `progress` | all | Normalized progress `[0..1]` |
| `signal` | `onMount` | `AbortSignal` — aborted on unmount |
| `libs` | `onMount` | On-demand library loader (`await libs.load('THREE')`) |

---

### Props System

Declare `static props` on your class to expose fields in the Inspector:

```js
static props = {
  // Primitive types
  message:  { type: 'string',  default: 'Hello' },
  speed:    { type: 'number',  default: 1, min: 0, max: 10 },
  visible:  { type: 'boolean', default: true },
  tint:     { type: 'color',   default: '#ff0000' },

  // Dropdown
  align:    { type: 'select', options: ['left', 'center', 'right'], default: 'center' },

  // Entity / Asset references
  subtitle: { type: 'entity', label: 'Subtitle Source' },
  bgMusic:  { type: 'asset',  label: 'Background Audio' },

  // Struct — single collapsible group of sub-fields
  style: {
    type: 'struct',
    label: 'Style',
    fields: {
      bgColor:   { type: 'color',   default: '#1a1a2e' },
      textColor: { type: 'color',   default: '#ffffff' },
      fontSize:  { type: 'number',  default: 14, min: 8 },
      bold:      { type: 'boolean', default: false },
    }
  },

  // Struct array — draggable list of structured items (add / remove / reorder in Inspector)
  nodes: {
    type: 'struct[]',
    label: 'Flow Nodes',
    fields: {
      id:          { type: 'string', default: '' },
      label:       { type: 'string', default: 'Node' },
      shape:       { type: 'select', options: ['box', 'diamond', 'circle'], default: 'box' },
      color:       { type: 'color',  default: '#4a90e2' },
      connections: { type: 'string', default: '' }, // comma-separated target IDs
    }
  },
};
```

**struct** renders as a collapsible group. **struct[]** renders as a drag-to-reorder list with per-item expand. Both pass plain JS values to the script — no unwrapping needed:

```js
onUpdate({ props }) {
  const { bgColor, textColor } = props.style;  // struct → plain object
  const nodes = props.nodes;                    // struct[] → plain array of objects
}
```

`entity` / `asset` subfields inside a struct are also resolved to `EntityRef` / `AssetRef` at runtime.

Canvas-kind scripts automatically receive **CANVAS SIZE** controls in the Inspector (`canvasWidth` / `canvasHeight`) — no need to declare them in `static props`.

---

### SubtitleTrack — Reading Subtitles in Scripts

An entity with a `SubtitleTrack` component is referenced via an `entity` prop. Call `getPhraseAt(localTime)` to read subtitle context.

#### `SubtitlePhraseContext`

| Field | Type | Description |
|---|---|---|
| `text` | `string` | **Recommended display text** — mode-aware, use this for simple rendering |
| `phrase` | `SubtitlePhrase \| null` | Active phrase object (null in a gap) |
| `prev` | `SubtitlePhrase \| null` | Previous phrase |
| `next` | `SubtitlePhrase \| null` | Next phrase |
| `index` | `number \| null` | Index of active phrase (null in gap) |
| `mode` | `'set' \| 'add'` | Effective display mode of the active phrase |
| `sentenceText` | `string` | Accumulated text from nearest `SET` boundary to current phrase |
| `sentencePhrases` | `SubtitlePhrase[]` | Phrase objects of the current sentence group |
| `accumulatedText` | `string` | All phrase text concatenated from track start |
| `accumulatedPhrases` | `SubtitlePhrase[]` | All phrase objects from track start |

#### `SubtitlePhrase`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique phrase ID |
| `startTime` | `number` | Start time in seconds (entity-local) |
| `endTime` | `number` | End time in seconds (entity-local) |
| `text` | `string` | Phrase text |
| `mode` | `'set' \| 'add'` | Per-phrase display mode |
| `duration` | `number?` | Duration in seconds (present in `timingMode: 'duration'`) |
| `words` | `SubtitleWord[]?` | Word-level timing (from Whisper transcription) |
| `emphasis` | `boolean?` | Styling hint |

#### Example

```js
import { CanvasComponent } from '@blahblah/sdk';

export default class SubtitleRenderer extends CanvasComponent {
  static props = {
    subtitleSource: { type: 'entity', label: 'Subtitle Track' },
  };

  onUpdate({ time, props }) {
    const { ctx, canvasWidth, canvasHeight } = this;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const sub = props.subtitleSource?.getPhraseAt(time);
    if (!sub?.text) return;

    // sub.text is automatically SET vs ADD aware:
    //   SET phrase → only that phrase's own text
    //   ADD phrase → full accumulated sentence text
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${canvasHeight * 0.07}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(sub.text, canvasWidth / 2, canvasHeight * 0.85);
  }
}
```

---

### SubtitleTrack — Timing Modes (Inspector)

| Mode | Description |
|---|---|
| **Duration (Sequential)** | Each phrase has a `dur` field. Phrases chain sequentially — changing one duration shifts all following phrases. |
| **Range (In / Out)** | Each phrase has explicit `in` / `out` timestamps for precise manual placement. |

---

### SubtitleTrack — Display Modes (Inspector)

Toggle the badge on any phrase row to switch its mode individually:

| Badge | Color | Behavior |
|---|---|---|
| `SET` | Purple | Starts a new sentence group — replaces previous text |
| `+ADD` | Cyan | Appends to the previous sentence group (`sentenceText`) |

The track-level **Mode** dropdown sets the fallback default for new phrases.

---

### Math & Interpolation

```js
import { interpolate, spring, Easing, MathUtils } from '@blahblah/sdk';

// Remotion-style value mapping
const opacity = interpolate(time, [0, 0.5, 1], [0, 1, 0], {
  easing: Easing.inOutCubic,
  extrapolateRight: 'clamp',
});

// Spring physics (returns value 0→1)
const scale = spring({ frame, fps, config: { stiffness: 200, damping: 20 } });

// Math utils
const v = MathUtils.lerp(0, 100, progress);
const r = MathUtils.remap(time, 0, 5, 0, 1);
const d = MathUtils.degToRad(45);
```
