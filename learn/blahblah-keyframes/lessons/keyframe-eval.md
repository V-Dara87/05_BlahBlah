---
format_version: 3
id: keyframe-eval
title: Which keyframe owns the curve
chapter: C2
goal: Say which keyframe supplies the easing for a segment, and what a field evaluates to outside the keyed range.
prerequisites: [overview]
code_refs:
  - blah-blah/packages/blahblah-core/src/render.js#L60-L87
est_minutes: 9
language: en
---
## Overview

A field can have several keys, and each key carries its own two control points. This lesson shows which of the two keys in a segment you are actually reading, and how the evaluator behaves at the edges.

Questions this lesson answers:
- Whose control points shape the segment between two keys?
- What happens before the first key and after the last?
- When does a value switch instead of blending?

## Vocabulary

- bezier: the curve defined by two control points that turns linear progress into eased progress.
- easing: the mapping from time progress to value progress, produced by that curve.

## Steps

### Step 1: The earlier key owns the curve

The pair is read left to right. `cp1` and `cp2` come from the earlier key, while the later key supplies only its value and time (blah-blah/packages/blahblah-core/src/render.js#L68-L77).

:::code
ref: blah-blah/packages/blahblah-core/src/render.js#L60-L87
notes:
  L65: At or before the first key, the first value is returned.
  L71: The loop finds the surrounding pair.
  L79: The numeric branch needs both values to be numbers.
:::

:::why
q: Key A sets x=0 at 0s with easeInOut. Key B sets x=300 at 1s with bounce. At 0.5s, whose curve shapes the motion?
answer: A's. Changing B's ease does nothing to the A to B move, because B's control points only apply to the segment that starts at B.
:::

### Step 2: Before the first key and after the last

`evaluateFieldAtTime` returns the first value for any time at or before the first key, and the last value for any time at or after the last (blah-blah/packages/blahblah-core/src/render.js#L60-L66). A field with one key returns that value everywhere.

:::why
q: The only opacity key sits at 2s with value 0, and the clip starts at 0s. What is opacity at 0.5s?
answer: 0, the first key's value. There is no separate "hold the static transform until the first key" rule.
:::

### Step 3: Numbers blend, everything else switches

When both values are numbers, the eased progress mixes them (blah-blah/packages/blahblah-core/src/render.js#L79-L81). Anything else, such as a colour string, returns the later `value` once `progress` reaches half (blah-blah/packages/blahblah-core/src/render.js#L82).

:::why
q: A colour field goes from red at 0s to blue at 1s. What is drawn at 0.49s?
answer: Red. Nothing blends colours here, so the change is a hard switch at the midpoint, not a fade.
:::

## Teach-back

:::teach-back
In three or four sentences: which keyframe supplies the easing, what happens before the first keyframe, and why a colour switches instead of blending.
:::

## Summary

- The earlier keyframe of a pair supplies the control points.
- Before the first key and after the last, the nearest end value is used.
- Only two numbers blend; anything else switches at the midpoint.
