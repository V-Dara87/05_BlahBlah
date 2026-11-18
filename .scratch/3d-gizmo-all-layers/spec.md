# 3D Gizmo for all drawn layers

Triage label (to apply on publish): `ready-for-agent`

## Problem Statement

BlahBlah has a 3D transform gizmo (Move / Rotate / Scale axis handles), but it only appears for 3D Shape layers (cube, cylinder, pyramid, sphere) that have 3D mode on. When the author turns on 3D mode for any other drawn layer (Video, Text, 2D Shape, Canvas / React / MonoBehaviour script layers), the gizmo is still the old 2D one: a flat rectangle with a rotate dot and four corner scale handles.

That 2D gizmo is wrong for a 3D layer:

- Its outline ignores perspective, so it does not match the projected layer.
- Its position is computed from the 2D `x/y`, not from the projected position, so it can drift away from the layer.
- It cannot move, rotate or scale along X / Y / Z.
- Dragging a selected Video's body writes the screen movement straight into `x/y`, which is a second, conflicting way to move a 3D layer next to the axis handles.

The author has to type numbers in the Inspector to place a Video or Text layer in 3D space.

## Solution

Every drawn layer that has 3D mode on gets the same 3D gizmo that 3D Shapes already have:

- Axis handles for Move / Rotate / Scale (W / E / R switches the tool), with the origin at the layer's pivot.
- A selection outline drawn as the projected Layer Box (a quadrilateral that follows perspective), replacing the 2D rectangle.
- Flat Layers (no thickness) hide the Z-scale handle and offer only X / Y and a uniform centre scale. Mesh Layers keep three axes.
- Dragging the body of a selected 3D layer moves it on the plane of its current `z`: only `x/y` change.

Layers with 3D mode off keep today's 2D gizmo, unchanged. 3D mode is never turned on automatically by selecting or clicking a layer.

## User Stories

1. As an author, I want a selected Video layer with 3D mode on to show the 3D axis gizmo, so that I can place it in 3D space by dragging instead of typing numbers.
2. As an author, I want the same for Text layers, so that titles can be moved and rotated in 3D visually.
3. As an author, I want the same for 2D Shape layers (rect, circle, etc.) with 3D mode on, so that flat shapes can be arranged in depth.
4. As an author, I want the same for Canvas, React and MonoBehaviour script layers with 3D mode on, so that script-driven layers behave like every other layer in 3D.
5. As an author, I want the existing 3D Shape (Mesh Layer) gizmo to keep working exactly as before, so that nothing I already use regresses.
6. As an author, I want a layer with 3D mode off to keep the current 2D gizmo, so that my 2D workflow is untouched.
7. As an author, I want 3D mode to be switched on only when I choose it (the Transform toggle), so that clicking a layer never silently changes my project data.
8. As an author, I want the 3D gizmo to appear the moment I turn 3D mode on for the selected layer, so that the switch is immediately visible.
9. As an author, I want the gizmo to disappear and the 2D gizmo to return when I turn 3D mode off, so that the two modes feel like one consistent switch.
10. As an author, I want the selection outline of a 3D Video or Text layer to follow the perspective of the projected layer, so that the outline matches what I see.
11. As an author, I want the outline to be the same Layer Box that preview and export use, so that what I select is what gets rendered and exported.
12. As an author, I want the axis gizmo origin to sit on the layer's pivot, so that rotating and scaling visibly happen around the point I expect.
13. As an author, I want to move a 3D layer along a single axis by dragging an arrow, so that I can change X, Y or Z independently.
14. As an author, I want to rotate a 3D layer around X, Y or Z by dragging a ring, so that I can tilt layers in space.
15. As an author, I want Shift while rotating to snap to 15 degree steps, as with Mesh Layers today.
16. As an author, I want to scale a 3D layer with the scale handles, so that I can resize it in the viewport.
17. As an author, I want Flat Layers (Video, Text, 2D Shape, script layers) not to show a Z-scale handle, so that I am not offered a handle that has no visible effect.
18. As an author, I want Flat Layers to still offer X / Y scale and a uniform centre scale, so that resizing works normally.
19. As an author, I want Mesh Layers to keep X / Y / Z scale and uniform scale, so that 3D shapes can still be scaled in depth.
20. As an author, I want to drag the body of a selected 3D layer to move it, so that I do not have to hit a thin arrow.
21. As an author, I want body drag to change only `x` and `y` and keep `z`, so that the saved meaning matches today's 2D move and keyframes do not pick up a stray depth change.
22. As an author, I want the layer to stay under the mouse cursor while I body-drag it, even when it is far from the camera, so that the drag feels direct.
23. As an author, I want the first click on a layer to only select it and a later press to start the drag, as with every other layer today.
24. As an author, I want body drag of a 3D Shape to behave the same as body drag of a 3D Video, so that all 3D layers feel consistent.
25. As an author, I want a drag that would send the layer to infinity (camera looking at the layer plane edge-on) to be ignored for that frame, so that the layer never flies off screen.
26. As an author, I want the layer to keep its last valid position during such a frame, so that the drag recovers when the angle becomes usable again.
27. As an author, I want W / E / R to switch the 3D tool while a 3D layer is selected, so that I can change tools with the same shortcuts as Mesh Layers.
28. As an author, I want W / E / R to do nothing for 2D layers, so that the 2D gizmo stays as it is today.
29. As an author, I want the gizmo to appear in both the normal preview and the Scene View, so that I can edit from either viewport.
30. As an author, I want the Scene View gizmo to follow the Demo Camera while poses still come from the Project Camera, so that editing in the Scene View stays consistent with preview and export.
31. As an author, I want the gizmo to work for a 3D layer whose parent also has 3D mode, so that parent and child transforms still compose correctly.
32. As an author, I want the dragged values to keep auto-key behaviour like other Transform edits, so that animating by dragging still works.
33. As an author, I want the drag readout (X / Y / Z, angle, scale) to show while I drag, so that I can see exact numbers.
34. As an author, I want a Camera entity to be left alone by this feature, so that its own target reticle workflow is unchanged.
35. As an author, I want Audio, Subtitle and Transition items not to get a 3D gizmo, so that I am not shown handles for things with no drawn rectangle.
36. As an author, I want an empty parent (Transform only, nothing drawn) not to get a 3D gizmo, so that scope stays limited to drawn layers; I can still edit it in the Inspector.
37. As an author, I want a 3D layer that is behind the camera to show no gizmo, as 3D Shapes do today, so that I do not see handles at meaningless positions.
38. As a maintainer, I want one definition of which layers are 3D Layers, Flat Layers and Mesh Layers, so that preview, Scene View and drag logic never disagree.
39. As a maintainer, I want the new body-drag solver to be a pure function next to the existing Move / Rotate / Scale solvers, so that it can be tested without the UI.
40. As a maintainer, I want a glossary (`CONTEXT.md`) with the agreed terms, so that future work uses the same words.

## Implementation Decisions

- **Terms** (to be added to a new `CONTEXT.md`, glossary only, no implementation detail):
  - **3D Layer**: a drawn entity whose 3D mode (`is3D`) is on.
  - **Flat Layer**: a 3D Layer that has no thickness: Video, Text, Script (Canvas / React / MonoBehaviour), 2D Shape.
  - **Mesh Layer**: a 3D Layer whose Shape is a 3D primitive (cube, cylinder, pyramid, sphere).
  - **Layer Box**: the rectangle a layer is rasterized into and projected; the single source used by preview, Scene View and export.
- **Eligibility.** The 3D gizmo is shown for a selected, editable 3D Layer that is in front of the camera. The gate changes from "Mesh Layer only" to "any 3D Layer". 3D mode off keeps the 2D gizmo. There is no auto-promotion of 2D to 3D.
- **Out of eligibility.** Camera entities (own target-reticle workflow), Audio, Subtitle and Transition items, and entities that have a Transform but draw nothing (empty parents).
- **Existing drag logic is reused.** The existing 3D gizmo drag handler is component-agnostic (it works from local transform, projected transform and the parent matrix), so the Move / Rotate / Scale handles need no new maths for Flat Layers. The work is in rendering gates and the new body drag.
- **Selection outline.** For 3D Layers the 2D rectangle outline is not drawn. The 3D gizmo draws the projected Layer Box as a quadrilateral. Layer Box comes from the shared Layer Box function; no component-specific measuring (Text and Script layers therefore use the frame-sized box; accepted trade-off, consistent with preview and export).
- **Gizmo origin.** The pivot. Rotation and scale already happen around the pivot, so the handles and the result agree.
- **Scale handles on Flat Layers.** The Z-scale handle is hidden. X / Y and the uniform centre handle remain. Mesh Layers keep three axes. The gizmo component needs a way to be told which kind of layer it is drawing (for example a Flat flag) rather than inferring it.
- **Body drag on 3D Layers.** Replaces the current 2D screen-space move for Video and for Overlay layers with one 3D path for every 3D Layer (Mesh Layers included).
  - The pointer ray is intersected with the plane at the layer's current `z` (in the parent's coordinate space, so parented layers behave correctly).
  - Only `x` and `y` are written; `z` is unchanged.
  - If the ray is nearly parallel to the plane (camera looking at the plane edge-on), the frame is ignored and the last valid position is kept. A cap on how far one frame can move the layer guards against jumps.
  - The first-click-selects / later-press-drags rule is unchanged. No Shift axis lock in this spec.
- **Solver placement.** The body-drag solver is a new pure function in the gizmo engine, beside the existing move / rotate / scale solvers, using the same geometry and parent-matrix inputs.
- **Keyboard.** W / E / R switch the 3D tool for 3D Layers. For 2D layers they are ignored; the 2D gizmo is unchanged.
- **Viewports.** Both the normal preview and the Scene View use the same overlay path, so the behaviour follows ADR 0002 (shared pipeline; poses from the Project Camera, view from the Demo Camera). No separate Scene View gizmo code.
- **Data / schema.** No schema change. The drag writes the existing Transform fields (`x`, `y`, `z`, rotations, scales) through the existing keyframe-aware update path.

## Testing Decisions

- **What makes a good test here:** assert external behaviour (given a layer pose, camera and pointer positions, what `x/y/z`, rotation or scale come out), not which functions were called or how the SVG is built.
- **The one seam:** the gizmo engine module's pure solvers, tested at the existing gizmo engine test file. Existing seam preferred; no new seams.
- **Cases to cover at that seam:**
  - Body-drag solver: moves `x/y` only and leaves `z` untouched; the layer stays under the pointer for a far-away layer; works with a parent matrix; works for a rotated and scaled parent.
  - Edge-on ray: the frame is ignored and the last valid pose is returned; the per-frame cap holds.
  - A move that returns to the start pointer position returns the start pose.
  - Eligibility helper (3D Layer / Flat Layer / Mesh Layer classification) if it is placed in the engine: Video, Text, 2D Shape, Script, 3D Shape, Camera, Audio, empty parent.
  - Flat Layers produce no Z-scale handle geometry; Mesh Layers keep it (if the handle set is built in the engine).
- **Prior art:** the existing gizmo engine tests (Move / Rotate / Scale solver tests), and the existing Scene View consistency tests, which check that Scene View and preview agree with a matched Demo Camera.
- UI wiring (which component renders which gizmo) is not given its own tests; it is covered by manual check against the Scene View "Match Project Camera" consistency from ADR 0002.

## Out of Scope

- Camera entities and the Camera target reticle.
- Audio, Subtitle and Transition items.
- Empty parent / group entities (Transform only).
- Auto-promoting a 2D layer to 3D on click.
- Measuring real content size for Text and Script layers (selection outline uses the Layer Box).
- Shift axis lock during body drag, plane handles, and multi-select gizmo.
- Any change to the 2D gizmo for layers with 3D mode off.
- Any schema or project-file change.

## Further Notes

- Related decisions: `docs/adr` 0001 (relative camera target offset) and 0002 (Scene View uses the shared pipeline with a Demo Camera). This spec follows 0002 and does not need a new ADR: the choices are reversible and not surprising.
- Existing issue worth confirming during implementation: the current 2D gizmo on 3D Video and Overlay layers positions itself from the 2D `x/y`, which is likely off under perspective. This spec removes that path for 3D Layers.
- Not yet read: the rotate-ring and scale-cube part of the gizmo component. The Flat flag that hides the Z-scale handle should be confirmed against that code when implementing.