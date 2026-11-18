Status: implemented, waiting for a manual browser check

# Scene View: Demo Camera

## Problem Statement

In the Scene View, the layers, the wireframes and the grid did not line up, and they drifted apart when the panel was resized. The Scene View also showed a Camera Inset that re-rendered every layer a second time (including a second set of videos), which made it heavy. The author could not trust the Scene View to show where layers really are, or to compare it with what the Camera View and the export show.

## Solution

The Scene View becomes a Demo Camera viewport. The Demo Camera is a temporary look-around camera that is never saved or exported. It stays active during playback. The project frame is laid out at its real pixel size and scaled uniformly into the panel, so layers, wireframes, Camera Frustum, Ground Grid and axes share one coordinate system. A "Match Camera" button snaps the Demo Camera to the Project Camera once, and in that state the Scene View must show 3D layers exactly where the Camera View draws them. The Camera Inset is removed.

## User Stories

1. As an author, I want the Scene View to look around the scene with a Demo Camera, so that I can check where layers really are.
2. As an author, I want the Demo Camera to never be saved or exported, so that looking around cannot change my project.
3. As an author, I want to orbit, pan, dolly and fly the Demo Camera with the existing controls, so that I do not have to learn new ones.
4. As an author, I want view presets (Perspective, Top, Front, Right), so that I can jump to a standard angle.
5. As an author, I want a preset or the reset button to also reset the Demo Camera's lens and roll, so that a preset always gives the same view.
6. As an author, I want the Demo Camera to stay active while the timeline plays, so that I can watch the scene move from outside.
7. As an author, I want to open another preview tab to see the real output, so that I do not need the Scene View to switch cameras.
8. As an author, I want the Overlays (Ground Grid, layer wireframes, Camera Frustum, axes) to stay visible during playback, so that I can follow the camera's movement.
9. As an author, I want to turn the Ground Grid on and off, so that I can hide it when it is in the way.
10. As an author, I want the project frame shown as a dashed outline, so that I can see what the Camera View and the export cover.
11. As an author, I want layers outside the frame to still be visible in the Scene View, so that I can see things that slide in from outside.
12. As an author, I want layers, wireframes and the grid to stay aligned when I resize the panel, so that I can trust what I see.
13. As an author, I want a hidden dock tab to keep its last good size when it comes back, so that the view does not collapse.
14. As an author, I want a "Match Camera" button, so that I can start from exactly what the Project Camera sees.
15. As an author, I want Match Camera to be a one-time snap that does not follow, so that I can keep looking around afterwards.
16. As an author, I want Match Camera to use the Project Camera at the current playhead time, so that an animated camera matches the frame I am looking at.
17. As an author, I want Match Camera to also copy the Project Camera's field of view, zoom and roll, so that the picture really is the same.
18. As an author, I want Match Camera to still work when the project has no camera, so that it falls back to the default camera.
19. As an author, I want 3D layers in the Scene View to equal the Camera View when the Demo Camera is matched, so that the Scene View can be trusted.
20. As an author, I want layers that auto-orient towards the camera's point of interest to stay tied to the Project Camera, so that moving the Demo Camera never rotates or moves a layer.
21. As an author, I want a layer's parent chain and pivot to behave the same as in the Camera View, so that parented and pivoted layers are not misplaced.
22. As an author, I want orbiting all the way to a top-down view not to flip or roll the picture, so that the Top preset and manual orbiting are usable.
23. As an author, I want dragging the red Target Offset reticle to still edit the Project Camera, so that I can aim the camera from the Scene View.
24. As an author, I want mouse drags to track the cursor at the right speed at any panel size, so that navigation feels the same on every layout.
25. As an author, I want the Scene View to stay light now that the Camera Inset is gone, so that the editor does not lag.
26. As a maintainer, I want the Scene View to use the same projection as the Camera View and the export, so that there is no second projection to keep in sync.

## Implementation Decisions

- The Scene View goes through the shared render pipeline and the shared layer projection. There is no separate projection code (ADR 0002).
- Layer poses are computed with the Project Camera. Only the view comes from the Demo Camera.
- The Demo Camera stays orbit-based internally (target, distance, azimuth, elevation, field of view, zoom, roll).
- Match Camera converts the Project Camera's position and Target Offset (ADR 0001) into the orbit form, clamping distance and elevation to the Demo Camera's limits. A Project Camera outside those limits is matched as closely as allowed.
- The Demo Camera gained a roll, so a rolled Project Camera can be matched. Presets reset roll, field of view and zoom.
- The project frame is laid out at its real size and scaled uniformly into the panel, centred. The scale is measured from the Scene View's own panel, not from the Camera View's frame.
- The grid canvas covers the whole panel and is drawn in the same scaled coordinates as the layers.
- The look-at helper uses the world-down reference everywhere except for an exactly vertical view. It used to switch references at about 89.2 degrees of pitch, which rolled the picture by the azimuth.
- The Camera Inset is removed.
- Performance: the per-frame math is small (about 3 ms for 500 layers); any lag comes from the page layout and compositing of the layers. Removing the Camera Inset removes the second set of layers. Laying the world out once and moving the camera with a single 3D stage transform was not built.

## Testing Decisions

- A good test checks what the author would see through the Scene View's public functions, not how they are built inside.
- One seam: the Scene View projection in the engine. It takes the project, a time and a Demo Camera, and returns projected layers and wireframes.
- Parity: with the Demo Camera matched, each 3D layer's four corners equal the corners the Camera View uses (plain, rotated, auto-oriented towards the point of interest, and parented layers). The expected values come from the Camera View's own projection with the Project Camera.
- Pose independence: moving the Demo Camera never changes a layer's world matrix.
- Default camera: Match Camera with no project camera looks through the default camera.
- No flip: orbiting up to the top-down limit does not turn the picture by a large angle, at several azimuths.
- Prior art: the existing Scene View tests and the existing wireframe consistency test.

## Out of Scope

- 2D layers do not match the Camera View when the Demo Camera is matched. The Scene View shows them as flat cards at depth zero seen in perspective, so they look about 1.16 times larger with the default camera. Changing the default camera or that scale is parked.
- Dragging the Target Offset reticle still edits the Project Camera.
- The single 3D stage transform for performance (option B).
- Checking the stage scaling in a real browser: the layout code could not be run in the test environment.
- A second copy of the look-at helper in the SDK package was not changed.

## Further Notes

- Decisions: `docs/adr/0001-relative-camera-target-offset.md` and `docs/adr/0002-scene-view-uses-shared-pipeline-with-demo-camera.md`.
- Terms: `CONTEXT.md` (Project Camera, Demo Camera, Scene View, Match Project Camera, Overlays).
- Manual check still to do: resize the panel and confirm that layers, wireframes and grid move together; press Match Camera and compare the Scene View with the Camera View.