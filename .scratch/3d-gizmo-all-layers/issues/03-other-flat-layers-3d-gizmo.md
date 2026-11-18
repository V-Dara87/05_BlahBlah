# 03: Text, Script and 2D Shape layers show the 3D gizmo

**What to build:** Text, Canvas / React / MonoBehaviour Script layers and 2D Shapes with 3D mode on get the same 3D gizmo and projected outline as the Video layer. The gizmo now appears for any 3D-mode drawn layer instead of only 3D Shapes. Text and Script outlines use the Layer Box as is (frame-sized), consistent with preview and export.

**Blocked by:** 02

**Status:** implemented, manual UI check pending

- [ ] Each of Text, Canvas Script, React Script, MonoBehaviour and 2D Shape shows the 3D gizmo and projected outline when 3D mode is on and the layer is selected (manual check pending)
- [x] Z-scale is hidden for all of them; Mesh Layers keep three axes
- [x] Parent and child layers both in 3D mode compose correctly under drags
- [x] Layers with 3D mode off keep the 2D gizmo
- [x] Camera, Audio, Subtitle, Transition items and empty parents get no 3D gizmo