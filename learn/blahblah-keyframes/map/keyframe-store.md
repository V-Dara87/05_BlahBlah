---
type: pattern
title: How a keyframe is stored, and why the list stays sorted
links:
  - to: lessons/keyframe-store
    rel: depends-on
  - to: map/render-pipeline
    rel: depends-on
code_refs:
  - blah-blah/packages/blahblah-core/src/keyframes.js#L24-L74
  - blah-blah/packages/blahblah-core/src/keyframes.js#L4-L22
---
## What it does

`addKeyframe` finds the entity, checks the field name, and stores the key under the track and field it names (blah-blah/packages/blahblah-core/src/keyframes.js#L24-L46). The curve is not stored as an ease name: the two control points are copied from the preset (blah-blah/packages/blahblah-core/src/keyframes.js#L53-L70).

## Why it is built this way

Storing the control points keeps old projects stable when a preset is tuned later. The price is that changing a preset only affects keys added afterwards. Numeric strings from the CLI become numbers while colours and other strings stay as they are (blah-blah/packages/blahblah-core/src/keyframes.js#L17-L22).

## The rules around one field

An unknown ease name, a negative time and an empty value all throw before anything is written (blah-blah/packages/blahblah-core/src/keyframes.js#L48-L60). A new key replaces any key already at that exact time, and the list is sorted by time again (blah-blah/packages/blahblah-core/src/keyframes.js#L61-L72). `removeKeyframes` walks every track so it can delete keys without knowing where they live (blah-blah/packages/blahblah-core/src/keyframes.js#L76-L96).

## What it relates to

[[map/render-pipeline]] explains how these sorted lists become a value at a given time.
