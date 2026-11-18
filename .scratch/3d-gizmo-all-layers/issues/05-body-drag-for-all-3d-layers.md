# 05: Body drag works the same on every 3D layer

**What to build:** Dragging the body of a selected Video, Text, Script or 2D Shape with 3D mode on uses the same z-plane body drag as the 3D Shape. The old 2D screen-space move is no longer used for 3D layers. The first-click-selects, later-press-drags rule is unchanged.

**Blocked by:** 03, 04

**Status:** implemented, manual UI check pending

- [x] Body drag of every kind of 3D layer changes `x` and `y` only and keeps `z`
- [x] Layers with 3D mode off still use today's 2D drag
- [x] No two conflicting move behaviours remain on a 3D layer (body drag and axis arrows agree)
- [ ] Works in the normal preview and the Scene View (manual check pending)