---
type: notebook
id: blahblah-keyframes
title: BlahBlah animation core
language: en
term_style: keep-english
goal: Read the keyframe and render code, and predict what a frame looks like at a given time.
level: intermediate
source_root: "D:/07_Programming/00_Project/05_BlahBlah"
format_version: 3
---
# BlahBlah animation core

Three layers, in the order a frame travels through them: the project file, the keyframes stored on an entity, and the evaluator that turns a time into a transform and draws it.

## Map

- [[map/project-model]] - What project.json holds, and how a save avoids clobbering
- [[map/keyframe-store]] - How a keyframe is stored, and why the list stays sorted
- [[map/render-pipeline]] - From a time in seconds to an SVG, a PNG or an FFmpeg plan

## Chapters

### C0: Overview
- [[overview]] What BlahBlah does in one page - the three layers this notebook follows

### C1: The project file
- [[project-file]] Editing the project without clobbering it - load, revision, save and the lock

### C2: Keyframes and evaluation
- [[keyframe-eval]] Which keyframe owns the curve - easing, clamping and non-numeric fields
  - [[keyframe-store]] How a keyframe is stored - presets, coercion and replacement

### C3: Output
- [[render-output]] From timeline time to pixels - the SVG and PNG renderers, and the FFmpeg plan
