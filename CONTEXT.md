# BlahBlah

A browser/desktop motion and video editor where layers are placed in a 3D scene and rendered through a camera.

## Language

### Cameras

**Project Camera**:
The camera authored on the timeline. It decides what the preview and the export show, and it is saved with the project.
_Avoid_: Main camera, scene camera, real camera

**Target Offset**:
The aiming direction of a Project Camera, stored as a vector relative to the camera's own position.
_Avoid_: Target, look-at point, POI position, absolute target

**Camera View**:
The preview that shows exactly what the Project Camera sees, matching the final export.
_Avoid_: Preview window, canvas output

**Demo Camera**:
A temporary look-around camera used only inside the Scene View. It is never saved, never exported, and never appears on the timeline.
_Avoid_: Editor camera, free camera, viewport camera

**Match Project Camera**:
A one-time action that moves the Demo Camera to the Project Camera's view at the current playhead time. It does not keep following afterwards.
_Avoid_: Sync camera, follow camera, lock to camera

### Scene View

**Scene View**:
The preview tab that shows the scene seen through the Demo Camera, with helper overlays, so the author can check where layers really are.
_Avoid_: 3D view, 3D preview, scene3d

**Overlays**:
The helper drawings in the Scene View: Ground Grid, layer wireframes, Camera Frustum and axes.
_Avoid_: Gizmos, helpers, debug layer

**Camera Frustum**:
The pyramid drawn in the Scene View that shows the Project Camera's field of view and where it looks.
_Avoid_: Camera cone, view box

**Ground Grid**:
The reference plane at Y = 0 in world space, drawn in the Scene View and fading out with distance.
_Avoid_: Floor grid, bottom mesh