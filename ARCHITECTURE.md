# blah-blah — Architecture & Strategy

Strategic direction for the editor: where we are, what to fix, and how to evolve (including Tauri and a from-scratch ideal). Complements [`roadmap.md`](./roadmap.md) (feature checklist).

**North star (one sentence):**

> **Tutorial overlay studio** — put animated callouts on video by drag, by keyframe, or by AI from transcript; export must match preview.

---

## What this app is (and is not)

| Is | Is not |
|---|---|
| Remotion-style code motion + timeline + Inspector | A DaVinci Resolve / general NLE competitor |
| Unity-like components on clips | A full game engine |
| Web-tech overlays (Three.js, React, canvas) on footage | A motion-graphics suite for broadcast |

**Target use case:** tutorial/creator videos — arrows, boxes, highlights, motion on top of screen recordings — easier than Resolve/Fusion, with optional AI from narration.

---

## Current architecture (summary)

```
Project folder (disk)
├── project.json      entities, tracks, scriptIndex, resolution
├── scripts/          .js / .jsx — edited in-app or external IDE
├── prefabs/
└── media/

Browser app (React + Vite)
├── App.jsx           project state, I/O, autosave, hot-reload poll
├── EntityRenderer    live preview (video + overlays + scripts)
├── exportRunner      frame-by-frame export (partial parity with preview)
├── scriptRunner      regex JSX transpile + new Function + motion tween
├── canvasRunner      CanvasRenderer lifecycle (onMount/onUpdate/onUnmount)
├── UnityInspector    schema-driven props + component cards
├── Timeline          tracks, clips, playhead
└── dockview          dockable panels
```

**Script contracts (today):**

| Type | Component | Use |
|---|---|---|
| Motion | `ScriptComponent` | `onStart` / `onUpdate` + `tween` on transform |
| React | `ReactRenderer` | JSX function component + props |
| Canvas | `CanvasRenderer` | `onMount` / `onUpdate` / `onUnmount` on a `<div>` |

Time is **timeline-driven** (`localTime = currentTime - clip.startTime`), not wall clock — correct for scrubbing and export (Remotion-style).

---

## Strengths (keep)

| Area | Why it matters |
|---|---|
| **Vision** | Code + GUI + timeline in one tool — underserved niche |
| **P0 done** | Unified `EntityRenderer`, `CanvasRenderer`, Inspector schema, undo, error boundaries |
| **Deterministic time** | Scrub/export use absolute timeline time |
| **On-disk projects** | `scripts/`, `project.json` — git + external IDE friendly |
| **CanvasRenderer** | Foundation for Three.js, anime.js, d3, etc. |
| **Roadmap scope** | Tutorial annotations, not Resolve clone |

---

## Weak points (fix or evolve)

| Issue | Severity | Notes |
|---|---|---|
| **No GUI keyframes** | Critical | Non-coders can't use it seriously; roadmap P1 #6 |
| **Preview ≠ export** | High | `EntityRenderer.jsx` vs `exportRunner.js` duplicated; React clips skip export |
| **Three script types** | High | Confuses users and AI; merge toward one clip + render mode long-term |
| **Regex script runtime** | High | `transpileJsxToJs` fragile; no real `import` / npm |
| **`App.jsx` god object** | Medium | ~1000 lines — split into stores/modules |
| **Browser FS limits** | Medium | File System Access API, 2s poll, permission loss, Chrome-ish |
| **No audio waveforms** | Medium | Hard to edit tutorial timing |
| **Built-in textarea editor** | Low | Deprioritize; external IDE + SDK types instead |

---

## Tauri — when and why

**Do not lead with Tauri.** It solves platform pain, not product pain.

| Tauri helps | Tauri does not fix |
|---|---|
| Real paths, native file watch | Missing keyframes |
| Native esbuild (faster than wasm) | Three script contracts |
| ffmpeg export option | Duplicate render paths |
| Better “open in VS Code” UX | Unclear product focus |

**Recommended:** ship core product in browser → wrap same Vite/React app in Tauri in **Phase 3** when limits hurt.

```
src-tauri/     Rust shell — file watch, spawn esbuild, optional ffmpeg
src/           Same React app as today
packages/
  runtime/     @blahblah/runtime (tween, mount, time injection)
  sdk/         Types for user scripts in scripts/
```

---

## If rebuilt from zero (ideal target)

Not a mandate to throw away current code — this is the **target shape** to evolve toward.

### Data model

```ts
Project
├── settings { resolution, fps, name }
├── assets[]           // video, audio, images on disk
├── tracks[]           // layer order
└── clips[]
      ├── id, trackId, start, duration
      ├── transform { x, y, rotation, scaleX, scaleY, opacity }
      ├── keyframes[]  // { time, field, value } — first-class
      └── source
            type: 'builtin' | 'script' | 'react'
            ref: 'ArrowCallout' | './scripts/SpinBox.js'
            props: { ... }
```

One clip, one transform, optional keyframes, optional script — not three parallel component systems.

### Single render pipeline

```ts
renderFrame(project, time, fps) → ImageBitmap | canvas
```

Used by: live preview, export, thumbnails, headless CLI. **One implementation.**

### Script / libraries

```
scripts/
package.json       // real npm deps
esbuild (watch)    // bundle on save
@blahblah/sdk      // TypeScript types for IDE
```

- Normal `import` (three, gsap, anime.js, framer-motion, …)
- Local `./helper.js` from `scripts/`
- React marked external (single React instance)
- Tailwind: PostCSS in app or project — React clips only

**Library fit:**

| Works well | Limits |
|---|---|
| three, gsap, anime.js, d3, pixi, matter-js, lottie | Browser ESM only |
| framer-motion (React clips) | React export must be fixed |
| Tailwind (React + CSS pipeline) | Not for raw Canvas/WebGL clips |
| Node-only packages (fs, sharp) | No |

All animation must be driven from timeline **`time`**, not free-running library clocks (scrubbing).

---

## Evolve vs rebuild

**Do not full-rebuild now.** P0 is done; timeline, preview, and Inspector work.

Evolve in phases:

### Phase 1 — Product (make it usable)

- [ ] GUI keyframes (Inspector + timeline lanes)
- [ ] Preset callouts (arrow, box, highlight, lower-third)
- [ ] Audio waveforms on timeline
- [ ] Keyframe ⇄ script bake (core differentiator)

### Phase 2 — Platform (make it serious)

- [ ] esbuild bundler + `@blahblah/sdk` types
- [ ] Unify preview + export (`renderFrame`)
- [ ] Fix React clip export
- [ ] Project schema versioning + migrations
- [ ] External IDE: disk-wins sync, faster reload, `scripts/jsconfig.json` on new project

### Phase 3 — Shell (remove browser limits)

- [ ] Tauri wrap (same React app)
- [ ] Native file watch + esbuild
- [ ] Optional ffmpeg export

### Phase 4 — Moat (differentiation)

- [ ] Transcript → timed overlays
- [ ] AI script / keyframe generation from narration
- [ ] Headless render CLI (`blahblah render project.json -o out.mp4`)
- [ ] Auto cut / repeated-take detection (see roadmap P1.5)

**Rebuild the engine only if** after Phase 1 the entity/component/three-script model still fights every feature. Keep Timeline, Inspector, and dock UI.

---

## Where to fix in this repo (concrete map)

| Priority | Location | Action |
|---|---|---|
| P0 product | New keyframe system | Inspector fields + timeline keyframe UI |
| P0 product | Presets | Built-in callout clips (shape + motion defaults) |
| Tech debt | `src/engine/scriptRunner.js` | Replace regex transpiler with esbuild-wasm |
| Trust | `EntityRenderer.jsx` + `exportRunner.js` | Extract shared `renderFrame()` |
| IDE | `src/services/projectFileSystem.js` | Disk-wins autosave, script `lastModified` |
| IDE | `packages/sdk` (new) | Types for motion / React / canvas contracts |
| Maintainability | `src/App.jsx` | Split: project store, playback, media, shell |
| Docs | `scripts/README.md` on project create | External IDE workflow |
| Later | `src-tauri/` | Tauri shell |

---

## AI layer (phase 4)

Built on stable clips + keyframes, not three script kinds:

```
Video → transcribe → timestamped transcript
     → LLM: "add arrow at 0:12 when speaker says X"
     → generate clip + keyframes or CanvasRenderer script
     → user tweaks in Inspector
     → export matches preview
```

Requires: error boundaries (done), stable Canvas contract (done), keyframes or script bake (pending).

---

## Decisions log

| Question | Decision |
|---|---|
| Continue this codebase? | Yes — niche is strong, P0 foundation is solid |
| Full rewrite? | No — evolve engine, keep UI |
| Tauri now? | No — after keyframes + unified render + bundler |
| Tauri eventually? | Yes — Phase 3 |
| #1 fix | GUI keyframes + tutorial presets |
| #2 fix | One render pipeline (preview = export) |
| #3 fix | Real bundler + SDK for external IDE |
| Built-in script editor vs VS Code? | External IDE is primary; in-app editor for quick edits only |

---

## Related docs

- [`roadmap.md`](./roadmap.md) — feature checklist (P0–P2, flaws)
- [`blah-blah/src/engine/ecs.js`](./blah-blah/src/engine/ecs.js) — renderer registry, CanvasRenderer contract
- [`blah-blah/src/engine/scriptRunner.js`](./blah-blah/src/engine/scriptRunner.js) — current script compile path (to be replaced)

---

*Last updated: 2026-09-01*
