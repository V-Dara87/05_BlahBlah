---
format_version: 3
id: keyframe-store
title: How a keyframe is stored
parent: keyframe-eval
chapter: C2
goal: Explain what addKeyframe writes, and predict what happens when a second key lands on the same time.
prerequisites: [keyframe-eval]
code_refs:
  - blah-blah/packages/blahblah-core/src/keyframes.js#L24-L74
est_minutes: 8
language: en
---
## Overview

This sub-lesson stays on the writing side. You will see what one stored key contains, and the three rules that keep a field's list usable by the evaluator.

Questions this lesson answers:
- What is stored on a key, and what is thrown away?
- What happens to a key already at the same time?
- Why does a numeric string from the CLI become a number?

## Vocabulary

- preset: a named pair of control points, such as easeInOut.
- coercion: turning an input string into a number only when it really is one.

## Steps

### Step 1: A key stores the curve, not its name

There are seven presets, from linear to overshoot (blah-blah/packages/blahblah-core/src/keyframes.js#L4-L12). `addKeyframe` copies `cp1` and `cp2` out of the chosen preset into the key (blah-blah/packages/blahblah-core/src/keyframes.js#L24-L70).

:::why
q: Why store the control points instead of the string "easeInOut"?
answer: A later change to the preset table would silently change old projects. Frozen control points keep a saved animation identical, at the cost of not updating old keys when a preset is tuned.
:::

### Step 2: Text is only turned into a number when it is one

`coerceKeyframeValue` converts a numeric string, but keeps colours and booleans as they are (blah-blah/packages/blahblah-core/src/keyframes.js#L17-L22). That is why a colour stays a switch at the midpoint in the evaluator.

:::why
q: Why not simply call Number(value) on everything?
answer: Number(true) is 1 and Number('') is 0. Coercing those would quietly change an empty or boolean input into a number, so the function checks that the string is non-empty and numeric first.
:::

### Step 3: A key at the same time replaces the old one

The new list drops any key with the same time, appends the new key, and sorts by time (blah-blah/packages/blahblah-core/src/keyframes.js#L61-L72). The field therefore never holds two values for the same moment, which is what lets the evaluator pick a surrounding pair by walking the list once.

:::code
ref: blah-blah/packages/blahblah-core/src/keyframes.js#L61-L74
notes:
  L61: Keys at the same time are filtered out first.
  L63: The id includes the track, field and time.
  L72: The list is rebuilt and sorted by time.
:::

:::task
title: Prove a second key at the same time replaces the first
instructions: Add a test to core.test.mjs that adds two keys at t=1 to the same field and asserts the list has one key with the second value. Under 15 minutes.
files: [blah-blah/packages/blahblah-core/tests/core.test.mjs]
expect: the test fails if the filter on line 61 is removed, and passes with the current code.
:::

## Teach-back

:::teach-back
Explain in 3 to 5 sentences what one stored key contains, and the two rules that keep a field's list usable at render time.
:::

## Summary

- A key stores a time, a value and two control points copied from the preset.
- Numeric strings become numbers; colours and booleans stay as they are.
- A new key at an existing time replaces the old key, and the list is sorted again.
