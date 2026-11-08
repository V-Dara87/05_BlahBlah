import { isTransitionClipEntity } from '../engine/ecs';

/**
 * Clip-overlap policy (Settings -> System -> "Overlapping clips").
 *
 *   'allow' - do nothing; overlapping clips share the row as sub-lanes (the
 *             original behaviour).
 *   'block' - an edit that would make a clip overlap another one is refused
 *             and a warning is shown.
 *   'up'    - the clip that would overlap is moved to the nearest free track
 *             ABOVE its own (a new track is created if there is none).
 *   'down'  - same, but BELOW.
 *
 * Pure: takes the entity/track lists before and after an edit and returns what
 * should be stored instead. Nothing here touches React or storage.
 *
 * Rules:
 *  - Only an overlap the edit CREATES counts. Clips that already overlapped
 *    before the edit (an old project, or the setting was 'allow' earlier) are
 *    left alone, so merely trimming one of them never reshuffles tracks.
 *  - Touching edges are not an overlap (EPS tolerance, well under a frame).
 *  - Transition clips are exempt: they overlap their neighbours by design.
 *  - Clips edited together (a multi-selection move) never count as overlapping
 *    each other; they keep their arrangement.
 *  - Locked tracks and tracks of a different `type` are never pushed onto.
 */

export const OVERLAP_EPS = 0.001;

const isFiniteClip = (c) => Number.isFinite(c?.startTime) && Number.isFinite(c?.duration);
const overlaps = (a, b) =>
  a.startTime < b.startTime + b.duration - OVERLAP_EPS &&
  b.startTime < a.startTime + a.duration - OVERLAP_EPS;

function newTrackFrom(template, tracks) {
  return {
    id: `track-${crypto.randomUUID()}`,
    name: `Track ${tracks.length + 1}`,
    type: template?.type ?? 'layer',
    parentTrackId: null,
    muted: false,
    locked: false,
    visible: true,
    volume: 1.0,
  };
}

/**
 * @param {object} args
 * @param {Array}  args.prevEntities  entities before the edit ([] for brand-new clips)
 * @param {Array}  args.nextEntities  entities after the edit (what would be stored)
 * @param {Array}  args.tracks
 * @param {string} args.mode          'allow' | 'block' | 'up' | 'down'
 * @param {Iterable<string>} args.changedIds  ids the edit touched or created
 * @returns {{ entities: Array, tracks: Array, blocked: boolean, moved: number, tracksChanged: boolean }}
 */
export function applyClipOverlapPolicy({ prevEntities = [], nextEntities, tracks = [], mode, changedIds }) {
  const unchanged = { entities: nextEntities, tracks, blocked: false, moved: 0, tracksChanged: false };
  if (mode !== 'block' && mode !== 'up' && mode !== 'down') return unchanged;

  const changed = new Set(changedIds);
  const prevById = new Map(prevEntities.map((e) => [e.id, e]));

  const candidates = nextEntities.filter(
    (e) => changed.has(e.id) && isFiniteClip(e) && !isTransitionClipEntity(e)
  );
  if (candidates.length === 0) return unchanged;

  const fixed = nextEntities.filter(
    (e) => !changed.has(e.id) && isFiniteClip(e) && !isTransitionClipEntity(e)
  );

  // Did `clip` already overlap `other` before this edit? (then it is not "new")
  const alreadyOverlapped = (clip, other) => {
    const before = prevById.get(clip.id);
    if (!before || !isFiniteClip(before)) return false;
    const otherBefore = prevById.get(other.id) || other;
    return before.trackId === otherBefore.trackId && overlaps(before, otherBefore);
  };

  const collidesOnTrack = (clip, trackId, placed) => {
    const probe = { ...clip, trackId };
    for (const o of fixed) {
      if (o.trackId === trackId && overlaps(probe, o) && !alreadyOverlapped(clip, o)) return true;
    }
    for (const p of placed) {
      if (p.id !== clip.id && p.trackId === trackId && overlaps(probe, p)) return true;
    }
    return false;
  };

  const needsMove = candidates.filter((c) => collidesOnTrack(c, c.trackId, []));
  if (needsMove.length === 0) return unchanged;
  if (mode === 'block') return { ...unchanged, blocked: true };

  const dir = mode === 'up' ? -1 : 1;
  let nextTracks = tracks;
  const assigned = new Map(); // clipId -> trackId
  const placedClips = []; // clips already re-homed this pass

  for (const clip of needsMove) {
    const trackIdx = () => nextTracks.findIndex((t) => t.id === clip.trackId);
    const origIdx = trackIdx();
    if (origIdx < 0) continue;
    const origTrack = nextTracks[origIdx];

    let target = null;
    for (let i = origIdx + dir; i >= 0 && i < nextTracks.length; i += dir) {
      const t = nextTracks[i];
      if (t.locked || (t.type ?? 'layer') !== (origTrack.type ?? 'layer')) continue;
      if (!collidesOnTrack(clip, t.id, placedClips)) { target = t.id; break; }
    }

    if (!target) {
      // Nothing free in that direction: open a new track at that end.
      const created = newTrackFrom(origTrack, nextTracks);
      nextTracks = dir < 0 ? [created, ...nextTracks] : [...nextTracks, created];
      target = created.id;
    }

    assigned.set(clip.id, target);
    placedClips.push({ ...clip, trackId: target });
  }

  if (assigned.size === 0) return unchanged;

  return {
    entities: nextEntities.map((e) => (assigned.has(e.id) ? { ...e, trackId: assigned.get(e.id) } : e)),
    tracks: nextTracks,
    blocked: false,
    moved: assigned.size,
    tracksChanged: nextTracks !== tracks,
  };
}