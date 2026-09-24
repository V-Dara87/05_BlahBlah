/**
 * Project templates — the starting points offered by New Project on the Hub.
 *
 * A template is deliberately NOT a bag of files: it is a resolution plus a
 * named track layout. That is exactly the part of a new project a user has to
 * re-do by hand every time (a tutorial project always wants Footage /
 * Overlay / Titles / Voiceover / Music; a vertical short wants a 9:16 canvas
 * and captions), and it is the part createNewProjectFolder() already accepts
 * (see services/projectFileSystem.js: `defaultTracks` + `resolution`).
 *
 * The `blank` template is the app's original default — four unnamed layer
 * tracks at 1080p — so someone who ignores the gallery gets exactly what they
 * got before it existed.
 *
 * Everything here is pure data + pure functions so it can be unit tested
 * without a DOM or a disk: buildTemplateTracks() is the only place that turns a
 * template into the track objects project.json is written with.
 */

// Explicit .js extension: this module is imported by node-run tests (see
// tests/project-templates.test.mjs), and node's ESM resolver — unlike Vite's —
// does not guess extensions. Same reason engine/ecs.js writes '../types.js'.
import { DEFAULT_RESOLUTION } from '../types.js';

/**
 * Templates, in the order the gallery shows them. `icon` is a KEY, not a
 * component: this file stays free of React so tests can import it directly, and
 * the modal maps the key to a lucide icon.
 */
export const PROJECT_TEMPLATES = Object.freeze([
  {
    id: 'blank',
    label: 'Blank',
    tagline: 'Four empty tracks, 1080p',
    description:
      'Nothing assumed. Four unnamed layer tracks on a landscape 1080p canvas — the same project the app has always created.',
    icon: 'layers',
    resolution: { width: 1920, height: 1080 },
    tracks: ['Track 1', 'Track 2', 'Track 3', 'Track 4'],
    keywords: ['empty', 'scratch', 'default', 'landscape'],
  },
  {
    id: 'tutorial',
    label: 'Video Tutorial',
    tagline: 'Annotate footage, narrate over it',
    description:
      'For screen recordings and walkthroughs: footage underneath, an overlay track for arrows and highlights, titles, plus separate voiceover and music tracks.',
    icon: 'video',
    resolution: { width: 1920, height: 1080 },
    tracks: ['Footage', 'Screen Capture', 'Overlay', 'Titles', 'Voiceover', 'Music'],
    keywords: ['screencast', 'walkthrough', 'how-to', 'training', 'annotation'],
  },
  {
    id: 'short',
    label: 'Vertical Short',
    tagline: '9:16 for Reels, Shorts and TikTok',
    description:
      'A vertical 1080×1920 canvas with a captions track, so word-level subtitles sit in the safe area instead of being cropped by the platform UI.',
    icon: 'smartphone',
    resolution: { width: 1080, height: 1920 },
    tracks: ['Footage', 'Overlay', 'Captions', 'Voiceover', 'Music'],
    keywords: ['reels', 'shorts', 'tiktok', 'vertical', 'portrait', '9:16'],
  },
  {
    id: 'explainer',
    label: 'Explainer / Motion',
    tagline: 'Built from shapes and type, not footage',
    description:
      'For Remotion-style motion graphics: a background track, one for shapes, one for icons, one for titles, and a music bed underneath.',
    icon: 'sparkles',
    resolution: { width: 1920, height: 1080 },
    tracks: ['Background', 'Shapes', 'Icons', 'Titles', 'Music'],
    keywords: ['motion', 'graphics', 'animation', 'remotion', 'infographic'],
  },
  {
    id: 'slide',
    label: 'Presentation',
    tagline: 'Slides, diagrams and narration',
    description:
      'A slide track over a background, a diagram track for callouts, and a voiceover track for the talking-head narration.',
    icon: 'presentation',
    resolution: { width: 1920, height: 1080 },
    tracks: ['Background', 'Slides', 'Diagrams', 'Titles', 'Voiceover'],
    keywords: ['deck', 'keynote', 'talk', 'lecture', 'slides'],
  },
  {
    id: 'podcast',
    label: 'Podcast',
    tagline: 'Audio-first, square, shownotes ready',
    description:
      'Square 1080×1080 for video podcasts: speaker tracks, a music bed, spot for sound effects, and a captions track.',
    icon: 'mic',
    resolution: { width: 1080, height: 1080 },
    tracks: ['Speaker A', 'Speaker B', 'Music', 'SFX', 'Captions'],
    keywords: ['audio', 'interview', 'square', '1:1', 'talk show'],
  },
  {
    id: 'promo',
    label: 'Promo / Trailer',
    tagline: 'Two footage lanes and a beat',
    description:
      'Cut between two footage lanes without stacking clips on one track, with an overlay, titles, SFX and a music bed for cutting to the beat.',
    icon: 'clapperboard',
    resolution: { width: 1920, height: 1080 },
    tracks: ['Footage A', 'Footage B', 'Overlay', 'Titles', 'SFX', 'Music'],
    keywords: ['trailer', 'teaser', 'ad', 'commercial', 'highlight'],
  },
  {
    id: 'cinematic4k',
    label: 'Cinematic 4K',
    tagline: 'UHD canvas with a grade lane',
    description:
      'A 3840×2160 canvas for high-resolution footage, with a dedicated grade track for colour and grain over the cut.',
    icon: 'film',
    resolution: { width: 3840, height: 2160 },
    tracks: ['Footage', 'B-Roll', 'Grade', 'Titles', 'Music'],
    keywords: ['4k', 'uhd', 'cinematic', 'film', 'colour', 'grade'],
  },
]);

/** The template used when someone never opens the gallery. */
export const DEFAULT_TEMPLATE_ID = 'blank';

/** Look up a template by id (undefined when the id is unknown). */
export function getProjectTemplate(id) {
  return PROJECT_TEMPLATES.find((template) => template.id === id);
}

/** The template for an id, or the default one when the id is missing/unknown. */
export function resolveProjectTemplate(id) {
  return getProjectTemplate(id) || getProjectTemplate(DEFAULT_TEMPLATE_ID);
}

/**
 * Build the `tracks` array to write into project.json for a template.
 *
 * Track ids are derived from the position (`track-1`, `track-2`, ...) rather
 * than a timestamp: a brand-new project has no clips to reference them yet, and
 * deterministic ids keep a project created from a template reproducible.
 *
 * Track type is always 'layer' — this app has unified tracks (see the note on
 * INITIAL_TRACKS in types.js): media and GameObjects live on any track, so
 * templates differ by NAME and COUNT, not by kind.
 */
export function buildTemplateTracks(template) {
  const resolved = template && Array.isArray(template.tracks)
    ? template
    : resolveProjectTemplate(DEFAULT_TEMPLATE_ID);
  return resolved.tracks.map((name, index) => ({
    id: `track-${index + 1}`,
    name,
    type: 'layer',
    parentTrackId: null,
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1.0,
  }));
}

/** The resolution a template creates, falling back to the app default. */
export function buildTemplateResolution(template) {
  const resolution = template?.resolution;
  const width = Number.isFinite(resolution?.width) && resolution.width > 0
    ? Math.round(resolution.width)
    : DEFAULT_RESOLUTION.width;
  const height = Number.isFinite(resolution?.height) && resolution.height > 0
    ? Math.round(resolution.height)
    : DEFAULT_RESOLUTION.height;
  return { width, height };
}

/** Resolution + tracks for a template id — what createNewProjectFolder() wants. */
export function buildTemplateProjectDefaults(templateId) {
  const template = resolveProjectTemplate(templateId);
  return {
    template,
    resolution: buildTemplateResolution(template),
    tracks: buildTemplateTracks(template),
  };
}

/** Free-text match over a template's label, tagline, description and keywords. */
export function matchProjectTemplate(template, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    template.label,
    template.tagline,
    template.description,
    template.id,
    ...(template.keywords || []),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}
