/**
 * Unified Tracks - Treats all media & GameObjects on any track equally
 */
export const INITIAL_TRACKS = [
  {
    id: 'track-1',
    name: 'Track 1',
    type: 'layer',
    parentTrackId: null,
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1.0
  },
  {
    id: 'track-2',
    name: 'Track 2',
    type: 'layer',
    parentTrackId: null,
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1.0
  },
  {
    id: 'track-3',
    name: 'Track 3',
    type: 'layer',
    parentTrackId: null,
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1.0
  },
  {
    id: 'track-4',
    name: 'Track 4',
    type: 'layer',
    parentTrackId: null,
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1.0
  }
];
 
//Timeline Zoom Parameter
export const DEFAULT_PIXELS_PER_SECOND = 40;
export const MIN_PIXELS_PER_SECOND = 10;
export const MAX_PIXELS_PER_SECOND = 160;
 
/**
 * Project Resolution — the actual pixel dimensions a project renders and
 * exports at. Chosen once at project creation (NewProjectModal), persisted
 * in project.json (see services/projectFileSystem.js), and read back into
 * App.jsx's `resolution` state on load. EntityRenderer's preview frame
 * derives its aspect-ratio directly from this instead of a hardcoded 16:9,
 * so the preview always matches whatever the project was actually created
 * at (landscape, vertical/Reels, square, or a custom size).
 */
export const RESOLUTION_PRESETS = [
  { id: '1920x1080', label: '1920 × 1080 — Landscape (16:9)', width: 1920, height: 1080 },
  { id: '3840x2160', label: '3840 × 2160 — Landscape 4K (16:9)', width: 3840, height: 2160 },
  { id: '1280x720', label: '1280 × 720 — Landscape HD (16:9)', width: 1280, height: 720 },
  { id: '1080x1920', label: '1080 × 1920 — Vertical / Reels (9:16)', width: 1080, height: 1920 },
  { id: '1080x1080', label: '1080 × 1080 — Square (1:1)', width: 1080, height: 1080 },
  { id: 'custom', label: 'Custom…', width: null, height: null },
];
 
export const DEFAULT_RESOLUTION = { width: 1920, height: 1080 };
 
/**
 * Project-file schema version, stamped at the TOP LEVEL of every
 * project.json (see projectFileSystem.js). Bump whenever the saved project
 * structure changes in a way an older build can't safely read.
 *
 * Version 1 is the first stamped version: everything saved before the
 * script type/extension unification (ReactRenderer / CanvasRenderer /
 * MonoBehaviour components, non-.jsx script files) is treated as 0 and
 * migrated in place on load by migrateEntities (see engine/ecs.js).
 * Projects saved by this build always carry schemaVersion: 1.
 */
export const CURRENT_SCHEMA_VERSION = 1;
 