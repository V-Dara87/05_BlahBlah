# 02: A 3D-mode Video layer shows the 3D gizmo

**What to build:** Selecting a Video layer with 3D mode on shows the 3D axis gizmo (Move / Rotate / Scale) with its origin at the pivot, plus a selection outline drawn as the projected Layer Box. The 2D rectangle outline is not drawn for it. Z-scale is hidden because a Flat Layer has no thickness; X / Y and the uniform centre scale remain. Works in the normal preview and in the Scene View.

**Blocked by:** 01

**Status:** implemented, manual UI check pending

- [ ] With 3D mode on, a selected Video shows axis handles at its pivot and a perspective-correct outline that matches the rendered video (manual check pending)
- [x] Move, Rotate and Scale drags change the Transform values and respect auto-key like other Transform edits
- [x] No Z-scale handle is shown; X / Y and uniform centre scale work
- [x] A Video behind the camera shows no gizmo
- [x] With 3D mode off, the Video keeps today's 2D gizmo, and turning 3D mode on or off swaps between the two with no automatic change to project data
- [x] W / E / R switch the 3D tool for the 3D Video and are ignored for 2D layers
- [ ] Same result in the Scene View with the Demo Camera, consistent with the Match Project Camera check (manual check pending)
- [x] The existing 3D Shape gizmo is unchanged