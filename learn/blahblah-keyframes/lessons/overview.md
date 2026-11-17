---
format_version: 3
id: overview
title: What BlahBlah does in one page
chapter: C0
goal: Name the three layers a frame passes through, and say which file owns each one.
prerequisites: []
code_refs:
  - blah-blah/packages/blahblah-core/src/project.js#L10-L25
  - blah-blah/packages/blahblah-core/src/keyframes.js#L24-L74
  - blah-blah/packages/blahblah-core/src/render.js#L60-L87
est_minutes: 8
language: en
---
## Overview

BlahBlah is a headless motion tool: describe a project, add keys to fields, then ask for a frame at a time. This lesson names the three code layers in the order a frame passes through them, so the rest of the notebook has somewhere to attach.

Questions this lesson answers:
- Which file owns the project data, and which owns a keyframe?
- What does it mean to ask for "the frame at time t"?
- What exactly do the SVG and PNG renderers draw?

## Vocabulary

- entity: one drawable item, with a track, a time window and components.
- keyframe: a value for one field at one time, plus two bezier control points.
- schematic: a preview that shows position and size, not the script output.

## Steps

### Step 1: Three files, three jobs

project.js owns the project file: the tracks, the entities and the resolution (blah-blah/packages/blahblah-core/src/project.js#L10-L25). keyframes.js owns one field of one entity: it validates the key and stores it in time order (blah-blah/packages/blahblah-core/src/keyframes.js#L24-L74). render.js only reads: `evaluateFieldAtTime` takes a sorted list, a time and a default value (blah-blah/packages/blahblah-core/src/render.js#L60-L87).

:::code
ref: blah-blah/packages/blahblah-core/src/render.js#L60-L87
notes:
  L61: With no keys, the static transform value is used.
  L64: The list is copied and sorted before anything else.
  L79: Only two numbers are blended.
:::

:::why
q: Why does the evaluator sort a copy of the keyframe list instead of trusting the stored order?
answer: The project file is plain JSON that anything can edit. Sorting a copy keeps the renderer correct even when the stored list is out of order, and keeps that repair inside one function.
:::

### Step 2: A frame is a time, not an index

A frame request is a number of seconds. The evaluator keeps only entities whose window contains that second, and measures the time from the entity's start (blah-blah/packages/blahblah-core/src/render.js#L102-L133). Frames per second only matter when an FFmpeg command is planned.

:::why
q: An entity starts at 2s and lasts 1s. What is its local time at 2.5s?
answer: 0.5s. The start time is subtracted before the keys are read, so a key at 0.5 belongs half a second into the clip.
:::

### Step 3: What the renderers actually draw

`renderFrameSvg` writes one group per active entity with its transform and label (blah-blah/packages/blahblah-core/src/render.js#L175-L216). `renderFramePng` draws the same boxes into a pixel buffer and encodes the file itself (blah-blah/packages/blahblah-core/src/render.js#L326-L396). Neither one runs the entity's script; the output is a schematic preview.

:::why
q: Why is the PNG preview schematic rather than pixel-accurate?
answer: It draws a labelled box at the evaluated transform. Real script output would need a browser canvas, so the headless path deliberately stays schematic.
:::

## Teach-back

:::teach-back
In 3 to 5 sentences: what project.json holds, where a keyframe lives, and how a request for "the frame at 2.5s" becomes a drawn box.
:::

## Summary

- project.json holds the tracks, the entities and the resolution.
- A keyframe belongs to one track and one field, and its curve is stored as two control points.
- A frame request is a time in seconds; each entity sees time relative to its own start.
- The SVG and PNG renderers are schematic: they draw boxes, not script output.
