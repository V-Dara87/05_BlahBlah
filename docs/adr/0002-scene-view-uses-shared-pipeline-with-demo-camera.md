# Scene View Uses the Shared Pipeline with a Demo Camera

Status: accepted

The Scene View used its own projection path and a Camera Inset, and its layers and wireframes disagreed with the normal preview. We decided that the Scene View goes through the same render pipeline and projection as preview and export, with layer poses computed from the Project Camera and only the view taken from the Demo Camera. The Demo Camera stays active during playback, and the Camera Inset is removed. "Match Project Camera" doubles as the acceptance check: with the Demo Camera matched, the Scene View must look the same as the normal preview.

## Considered Options

- Keep separate projection code for the Scene View: rejected, because it is what caused the mismatch.
- Switch the Scene View to the Project Camera while playing: rejected, because the author can already open another preview tab to see the real output.
- Keep the Camera Inset: rejected, because it re-rendered every layer (including a second set of videos) for a view the other tabs already give.

## Consequences

- Auto-orient (towards point of interest) must stay tied to the Project Camera, so the pipeline needs a way to take a view camera separate from the pose camera.
- The Demo Camera is orbit-based internally; position plus Target Offset (ADR 0001) is used only when converting for "Match Project Camera".