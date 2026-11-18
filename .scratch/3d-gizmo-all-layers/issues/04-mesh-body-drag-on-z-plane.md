# 04: Dragging the body of a 3D Shape moves it on its z-plane

**What to build:** Dragging the body of a selected 3D Shape changes only `x` and `y`; `z` is left untouched. The pointer ray is intersected with the plane at the layer's current `z` in the parent's space, so the layer stays under the cursor even when far from the camera. If the camera looks at that plane edge-on, the frame is ignored and the last valid position is kept; a per-frame movement cap prevents jumps. The first click still only selects; a later press starts the drag.

**Blocked by:** 01

**Status:** implemented, manual UI check pending

- [x] Body drag of a selected 3D Shape changes `x` and `y` only; `z` is unchanged
- [x] The layer stays under the pointer for a layer far from the camera
- [x] Works with a parent (including rotated and scaled parents)
- [x] Edge-on view: the frame is ignored, the last valid position is kept, and the movement cap holds
- [x] Returning the pointer to its start position returns the layer to its start pose
- [x] The behaviour is covered by tests at the gizmo engine seam
- [x] Respects auto-key and shows the drag readout (manual check pending)