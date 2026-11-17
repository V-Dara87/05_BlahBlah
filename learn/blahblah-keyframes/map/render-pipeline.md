---
type: system
title: From a time in seconds to an SVG, a PNG or an FFmpeg plan
links:
  - to: lessons/render-output
    rel: depends-on
  - to: map/keyframe-store
    rel: uses
code_refs:
  - blah-blah/packages/blahblah-core/src/render.js#L92-L170
  - blah-blah/packages/blahblah-core/src/render.js#L60-L87
---
## What it does

`evaluateTimelineAtTime` keeps the entities that are active at the requested time and inside their own window, converts the time to `localTime`, and evaluates each transform field (blah-blah/packages/blahblah-core/src/render.js#L92-L133). The result is a plain list of active entities with a resolved transform, not a picture yet (blah-blah/packages/blahblah-core/src/render.js#L145-L169).

## How one field is resolved

`evaluateFieldAtTime` clamps at both ends, finds the surrounding pair, and turns the two times into a 0..1 `progress` (blah-blah/packages/blahblah-core/src/render.js#L60-L77). That progress goes through the Bezier solver. Numbers are mixed; anything else switches at the midpoint (blah-blah/packages/blahblah-core/src/render.js#L79-L82).

## What draws it

`renderFrameSvg` builds one SVG string from the active entities (blah-blah/packages/blahblah-core/src/render.js#L175-L216). `renderFramePng` draws the same schematic boxes into a pixel buffer and encodes the PNG itself (blah-blah/packages/blahblah-core/src/render.js#L326-L396). `exportWithFfmpeg` does not render the project: it returns a command plan that would produce a black placeholder (blah-blah/packages/blahblah-core/src/render.js#L398-L433).

## What it relates to

[[lessons/render-output]] follows one frame through all three outputs.
