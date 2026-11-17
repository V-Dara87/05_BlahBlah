---
format_version: 3
id: render-output
title: From timeline time to pixels
chapter: C3
goal: Follow one time value through the evaluator, the SVG renderer, the PNG renderer and the FFmpeg plan.
prerequisites: [overview]
code_refs:
  - blah-blah/packages/blahblah-core/src/render.js#L92-L170
est_minutes: 9
language: en
---
## Overview

The evaluator produces data, not pictures. This lesson follows that data into the two real renderers and the one output that is only planned.

Questions this lesson answers:
- Which entities end up in a frame?
- What is the difference between the SVG and PNG output?
- Does exportWithFfmpeg render anything?

## Vocabulary

- active entity: an entity that is inside its time window and on a visible track.
- schematic: a preview that draws a box at the evaluated transform.
- scanline: one horizontal row of pixels in the PNG.

## Steps

### Step 1: Build the active set

`evaluateTimelineAtTime` skips inactive entities and entities on a hidden track, then keeps the ones whose window contains the requested time (blah-blah/packages/blahblah-core/src/render.js#L92-L112). Each survivor gets a `localTime` and a fully evaluated transform.

:::why
q: Why does a hidden track remove the entity here instead of in the renderer?
answer: Both renderers and any future output need the same rule. Filtering once in the evaluator keeps the visible/hidden decision in one place.
:::

### Step 2: The SVG renderer writes a string

`renderFrameSvg` loops over the active entities and appends a group with translate, rotate, scale and opacity (blah-blah/packages/blahblah-core/src/render.js#L175-L216). Colors are checked before they reach an attribute.

:::why
q: Why validate the colour before putting it in the SVG?
answer: The colour comes from project data and lands in an attribute. A strict hex-or-name check stops an arbitrary string from breaking or injecting into the markup.
:::

### Step 3: The PNG renderer draws the same boxes

`renderFramePng` fills a pixel buffer, draws each entity box, then encodes PNG chunks itself (blah-blah/packages/blahblah-core/src/render.js#L326-L396). There is no canvas and no native dependency.

:::why
q: Why does the PNG path need a filter byte in front of every scanline?
answer: The PNG format stores each row with one leading filter type. Writing 0 means "no filter", which the decoder expects even when no filtering is used.
:::

### Step 4: The FFmpeg export is a plan

`exportWithFfmpeg` returns `planOnly` and a command string; it does not render the timeline (blah-blah/packages/blahblah-core/src/render.js#L398-L433). The command produces a black placeholder video.

:::why
q: Why return a plan instead of running FFmpeg?
answer: The command shown would encode a black clip, not the project frames. Returning the plan keeps the difference visible instead of shipping a video that looks finished but is empty.
:::

## Teach-back

:::teach-back
In 3 to 5 sentences: which entities reach a frame, what each renderer produces, and why the FFmpeg export is only a plan.
:::

## Summary

- The evaluator filters inactive entities and hidden tracks, then evaluates transforms.
- The SVG renderer builds one string; the PNG renderer writes pixels and encodes the file.
- The FFmpeg export is a plan for a black placeholder, not a real render.
