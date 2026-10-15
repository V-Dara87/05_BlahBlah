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

## AI Agent Automation & CLI (`@blahblah/cli` & `@blahblah/mcp`)

BlahBlah is fully automatable by AI agents (Cursor, Claude Desktop, Antigravity, custom scripts) via its CLI and MCP Server:

### 1. CLI Commands
```bash
# Initialize a new project
npm run cli -- project init "My Project" --res 1080p

# Inspect current project state (machine-readable)
npm run cli -- project inspect --json

# Add tracks and clips
npm run cli -- track add "Subtitles"
npm run cli -- clip add --file "./media/intro.mp4" --start 0 --duration 10

# Add code-driven overlay script & entities
npm run cli -- script new "MyOverlay" --type canvas
npm run cli -- entity add --name "Overlay" --script "MyOverlay" --track "track-2" --start 1 --duration 5

# Keyframe animation with easing
npm run cli -- keyframe add --id "<entity-id>" --field y --time 0 --value 100 --ease easeInOut

# Render frame preview at timestamp (SVG/inspection)
npm run cli -- render frame --time 2.5 --out preview.svg
```

### 2. Model Context Protocol (MCP) Server for AI
Configure in Cursor or Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "blahblah": {
      "command": "node",
      "args": ["<path-to-repo>/blah-blah/packages/blahblah-mcp/bin/mcp-server.mjs"]
    }
  }
}
```
Exposes tools: `blahblah_project_init`, `blahblah_project_inspect`, `blahblah_track_add`, `blahblah_clip_add`, `blahblah_entity_add`, `blahblah_keyframe_add`, `blahblah_script_create`, `blahblah_render_frame`, `blahblah_live_control`.


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

| Property / Method | Type | Description |
|---|---|---|
| `canvas` | `HTMLCanvasElement` | The managed canvas element |
| `ctx` | `CanvasRenderingContext2D` | 2D drawing context |
| `canvasWidth` | `number` | Current canvas width in px |
| `canvasHeight` | `number` | Current canvas height in px |
| `aspect` | `number` | `canvasWidth / canvasHeight` |
| `toScreen(x, y)` | `(x, y) => { x, y }` | Converts center-origin coords (where 0,0 is center) to canvas pixel coords |
| `fromScreen(x, y)` | `(x, y) => { x, y }` | Converts canvas pixel coords to center-origin coords |
| `centerOrigin()` | `() => void` | Centers 2D context origin so (0,0) is canvas center (`ctx.save()` + `ctx.translate()`) |
| `restoreOrigin()` | `() => void` | Restores context matrix saved by `centerOrigin()` |

```js
import { CanvasComponent } from '@blahblah/sdk';

export default class MyCanvas extends CanvasComponent {
  onMount({ props }) {
    // this.canvas, this.ctx, this.canvasWidth, this.canvasHeight are ready
  }
  onUpdate({ time }) {
    const { ctx, canvasWidth, canvasHeight } = this;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Option A: use toScreen helper with (0,0) center origin
    const { x, y } = this.toScreen(Math.sin(time * 2) * 100, 0);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();

    // Option B: center 2D context transform
    this.centerOrigin();
    // (0, 0) is now canvas center!
    this.restoreOrigin();
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
| `timelineTime` | `onMount`, `onUpdate`, `onSeek` | Global timeline time in seconds |
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

  // Entity / Asset references (with optional targetComponent / assetType filtering)
  subtitle: { type: 'entity', targetComponent: 'SubtitleTrack', label: 'Subtitle Source' },
  bgMusic:  { type: 'entity', targetComponent: 'AudioSource',   label: 'BGM Track' },
  sfx:      { type: 'asset',  assetType: 'audio',               label: 'Sound Effect' },

  // Primitive / Reference Arrays — reorderable lists of simple values or references
  tags:     { type: 'string[]', default: ['intro', 'vfx'], label: 'Tags' },
  steps:    { type: 'number[]', default: [1, 5, 10] },
  gallery:  { type: 'asset[]',  assetType: 'image',        label: 'Gallery Assets' },
  targets:  { type: 'entity[]', label: 'Follow Targets' },

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

- **Primitive arrays** (`string[]`, `number[]`, `color[]`, `boolean[]`, `asset[]`, `entity[]`) render as compact single-line items with drag handles, reordering, deletion, and addition. In scripts, they arrive as clean arrays: `props.tags` is `['intro', 'vfx']`, and `props.gallery` is an array of `AssetRef` objects.
- **struct** renders as a collapsible group.
- **struct[]** renders as a drag-to-reorder list with per-item expand.

All array and struct props pass plain JS values to the script — no unwrapping needed:

```js
onUpdate({ props }) {
  const { bgColor, textColor } = props.style;  // struct → plain object
  const nodes = props.nodes;                    // struct[] → plain array of objects
  const tags = props.tags;                      // string[] → plain array of strings
  const firstAsset = props.gallery[0];          // asset[] → AssetRef object
}
```

`entity` / `asset` references (both top-level and inside `asset[]`, `entity[]`, or struct subfields) are automatically resolved to `EntityRef` / `AssetRef` instances at runtime.

Canvas-kind scripts automatically receive **CANVAS SIZE** controls in the Inspector (`canvasWidth` / `canvasHeight`) — no need to declare them in `static props`.

---

### Script Gizmos — Interactive Viewport Handles

Scripts can expose interactive visual handles (gizmos) rendered directly on top of the preview viewport. Users can click, drag, multi-select, and configure these handles visually, with updates written automatically back to script `props` and timeline keyframes.

#### 1. Declaring Gizmos

##### Method A: Dynamic Hook `getGizmos()` (Recommended)

Implement `getGizmos({ props, time, canvasWidth, canvasHeight })` on your script class. This allows dynamic generation of handles based on current props, array lengths, or timeline time:

```js
import { CanvasComponent } from '@blahblah/sdk';

export default class InteractiveNodes extends CanvasComponent {
  static props = {
    nodes: {
      type: 'struct[]',
      default: [
        { id: 'start', label: 'Start', x: -200, y: 0 },
        { id: 'end', label: 'End', x: 200, y: 0 },
      ],
    },
  };

  getGizmos({ props }) {
    return (props.nodes || []).map((node, index) => ({
      id: node.id || `node-${index}`,
      label: node.label,
      x: node.x,
      y: node.y,
      propPath: `nodes[${index}]`, // Automatically writes dragged position back to this prop
      axes: 'xy',                  // 'xy' | 'x' | 'y'
      space: 'local',              // (0, 0) is canvas center (default)
      color: '#38bdf8',
      contextMenu: [
        { label: 'Reset Position', action: (gizmo) => { /* custom action */ } },
      ],
    }));
  }
}
```

##### Method B: Property Schema Annotation (`gizmo: true`)

Add `gizmo: true` or a gizmo options object to any `point2d`, `struct` with `x`/`y`, `struct[]`, or 1D `number` prop:

```js
static props = {
  // 2D Point (defaults to center 0,0)
  targetPoint: {
    type: 'point2d',
    default: { x: 0, y: 0 },
    gizmo: true, // or { axes: 'xy', color: '#ec4899' }
  },

  // 1D Slider handle along a single axis
  splitX: {
    type: 'number',
    default: 0,
    gizmo: { axis: 'x', size: 'compact' },
  },

  // Struct array with gizmo handles automatically bound to each element
  pins: {
    type: 'struct[]',
    gizmo: true,
    default: [{ x: -100, y: -50 }, { x: 100, y: 50 }],
  },
};
```

#### 2. `ScriptGizmoDef` Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | *(required)* | Unique identifier for the handle within the script |
| `label` | `string` | `id` | Label shown in viewport tooltips and HUD |
| `x` | `number` | `0` | X coordinate |
| `y` | `number` | `0` | Y coordinate |
| `space` | `'local' \| 'global'` | `'local'` | **Coordinate space**: `'local'` places `(0, 0)` at the canvas center (responsive to resolution/aspect ratio changes). `'global'` uses top-left canvas pixel coordinates `[0..width, 0..height]`. |
| `axes` | `'xy' \| 'x' \| 'y'` | `'xy'` | Drag axis constraint (`'xy'` = free 2D, `'x'` = horizontal only, `'y'` = vertical only) |
| `rotation` | `number` | `0` | Local rotation angle in degrees. In `'local'` space, axis drag arrows rotate along with the object's orientation. |
| `size` | `'compact' \| 'normal' \| 'large'` | `'normal'` | Display scale of the handle |
| `color` | `string` | `'#38bdf8'` | Accent color of the handle |
| `shape` | `'circle' \| 'rect' \| 'diamond'` | `'circle'` | Shape of the handle icon |
| `propPath` | `string` | - | Nested property path to update on drag (e.g. `'targetPoint'`, `'nodes[0]'`) |
| `onDrag` | `Function` | - | Optional drag callback `({ x, y, dx, dy }) => void` |
| `contextMenu` | `Array<{ label, action }>` | - | Custom right-click menu items |

#### 3. Viewport Interaction Features

- **Center Origin (0, 0)**: In default `'local'` mode, `(0, 0)` is the center of the canvas. Switching project aspect ratio (e.g. 16:9 to 9:16 Shorts) preserves center-aligned layouts automatically.
- **Axis Constraint & Snapping**: Dragging along axis arrows constrains motion to that axis. Holding `Shift` during a free drag snaps movement to the dominant axis.
- **Multi-Selection & Box (Marquee) Select**: Hold `Shift + Click` to select multiple gizmos for unified dragging. Click and drag on empty canvas background to box-select multiple handles.
- **Numerical Heads-Up Display (HUD)**: While dragging, a floating HUD displays coordinates `(X, Y)`, delta `(dx, dy)`, rotation angle, and active coordinate space (`LOCAL` / `GLOBAL`).
- **Right-Click Context Menu**: Right-click any gizmo in preview to:
  - Switch between Local and Global coordinates on the fly.
  - Reset position to center `(0, 0)`.
  - Align to X axis only.
  - Trigger custom actions defined on the gizmo.
- **Auto-Keying Integration**: If the timeline's **Auto-Key** button is active (or if existing keyframes exist on the property), dragging a gizmo records a keyframe at the current playhead time.

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

### Audio Sync & Audio Firing API (`EntityRef` & `AssetRef`)

Reference audio clips from the timeline (`targetComponent: 'AudioSource'`) or audio assets (`assetType: 'audio'`) to synchronize animations or trigger sound effects:

#### 1. Audio Sync API (Synchronize to Timeline Audio)
Read exact playback timing of a referenced audio clip:
- `audio.isPlayingAt(timelineTime)`: Checks if the audio clip is actively playing at the given timeline time.
- `audio.getAudioTime(time, isLocalTime)`: Media playback timestamp (seconds), factoring in clip start time, `mediaOffset`, and effective speed (`AudioSource.speed * Transform.speed`).
- `audio.getAudioProgress(time, isLocalTime)`: Normalized progress `[0.0, 1.0]` through the clip.
- `audio.getAudioSettings()`: Returns `{ volume, speed, effectiveSpeed, mediaOffset, muted, loop, src }`.
- `audio.audioSrc`, `audio.audioDuration`, `audio.endTime`, `audio.trackId`.

#### 2. Audio Firing API (Play & Sound Effects)
Trigger sound playback directly from scripts on both `AssetRef` and `EntityRef`:
- `ref.playOneShot(options)`: Plays a one-shot audio instance without interrupting previous plays (ideal for SFX, collisions, clicks). Auto-cleans up on end.
- `ref.play(options)`: Plays dedicated audio instance (resumes or restarts).
- `ref.pause()`: Pauses playback.
- `ref.stop()`: Stops playback and resets to beginning.
- `ref.isPlaying`: True when playing.
- `options`: `{ volume?: number, speed?: number, playbackRate?: number, loop?: boolean, offset?: number }`.

```js
export default class SoundEffectDemo {
  static props = {
    laser: { type: 'asset', assetType: 'audio', label: 'Laser SFX' },
  };

  onUpdate({ frame, props }) {
    if (frame === 10) {
      props.laser?.playOneShot({ volume: 0.8, speed: 1.2 });
    }
  }
}
```

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
