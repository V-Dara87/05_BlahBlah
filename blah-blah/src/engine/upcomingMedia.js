import { isVideoEntity, isAudioEntity } from './ecs';

/**
 * How far ahead (timeline seconds) a clip counts as "about to start". Long
 * enough to load and seek its media, short enough that only a handful of
 * extra <video>/<audio> elements are ever alive at once.
 */
export const MEDIA_LOOKAHEAD_SECONDS = 0.5;

const IDENTITY_TRANSFORM = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };

/**
 * Find the video and audio clips that start within `lookahead` seconds after
 * `time` and are not live yet.
 *
 * Why: after a cut, the second half is a brand-new clip. If its <video> only
 * mounts when the playhead reaches it, the browser has to load and seek it
 * first, so one frame is blank or stale. Mounting and parking it on its
 * in-point slightly earlier makes the cut seamless.
 *
 * Pure function. Returns `{ video, audio }`:
 *   video: [{ entity, transform, localTransform, transitionState }] shaped like
 *          the items VideoLayer already renders
 *   audio: [entity]
 *
 * @param {object} args
 * @param {Array}  args.entities
 * @param {Array}  [args.tracks]
 * @param {number} args.time        current timeline time (seconds)
 * @param {Set<string>} [args.activeIds] ids already live at `time` (skipped)
 * @param {number} [args.lookahead]
 */
export function findUpcomingMedia({ entities, tracks = [], time, activeIds = new Set(), lookahead = MEDIA_LOOKAHEAD_SECONDS }) {
  const video = [];
  const audio = [];
  if (!Array.isArray(entities) || !Number.isFinite(time)) return { video, audio };

  const trackMap = new Map((tracks || []).map((t) => [t.id, t]));
  const horizon = time + lookahead;

  for (const entity of entities) {
    if (!entity || entity.active === false) continue;
    const start = entity.startTime || 0;
    if (start <= time || start > horizon) continue;
    if (activeIds.has(entity.id)) continue;

    if (isVideoEntity(entity)) {
      const track = trackMap.get(entity.trackId);
      if (track && track.visible === false) continue;
      const comp = (entity.components || []).find((c) => c.type === 'VideoRenderer');
      if (!(comp?.src || entity.src)) continue;
      const tr = (entity.components || []).find((c) => c.type === 'Transform') || {};
      const transform = { ...IDENTITY_TRANSFORM, ...tr };
      video.push({ entity, transform, localTransform: transform, transitionState: null });
    } else if (isAudioEntity(entity)) {
      const comp = (entity.components || []).find((c) => c.type === 'AudioSource');
      if (!(comp?.src || entity.src)) continue;
      audio.push(entity);
    }
  }
  return { video, audio };
}