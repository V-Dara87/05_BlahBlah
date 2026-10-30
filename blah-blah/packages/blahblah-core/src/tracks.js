export function listTracks(project) {
  return project.tracks || [];
}

export function addTrack(project, {
  id,
  name,
  type = 'layer',
  visible = true,
  locked = false,
  muted = false,
  volume = 1.0,
} = {}) {
  const tracks = project.tracks || [];
  let trackId = id;
  if (!trackId) {
    // Pick the first free number: after a removal, `tracks.length + 1` can
    // collide with an id that is still in use.
    let n = tracks.length + 1;
    while (tracks.some((t) => t.id === `track-${n}`)) n++;
    trackId = `track-${n}`;
  }

  if (tracks.some((t) => t.id === trackId)) {
    throw new Error(`Track with id "${trackId}" already exists.`);
  }

  const trackName = name || `Track ${tracks.length + 1}`;
  const newTrack = {
    id: trackId,
    name: trackName,
    type,
    parentTrackId: null,
    muted,
    solo: false,
    locked,
    visible,
    volume,
  };

  project.tracks = [...tracks, newTrack];
  return newTrack;
}

export function removeTrack(project, trackId) {
  const tracks = project.tracks || [];
  const index = tracks.findIndex((t) => t.id === trackId);
  if (index === -1) {
    throw new Error(`Track "${trackId}" not found.`);
  }

  const removed = tracks[index];
  project.tracks = tracks.filter((t) => t.id !== trackId);

  // Remove the entities on this track, plus any children of those entities
  // (a child may live on another track but would be left without a parent).
  if (project.entities) {
    const toDelete = new Set(
      project.entities.filter((e) => e.trackId === trackId).map((e) => e.id)
    );
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of project.entities) {
        if (e.parentId && toDelete.has(e.parentId) && !toDelete.has(e.id)) {
          toDelete.add(e.id);
          grew = true;
        }
      }
    }
    project.entities = project.entities.filter((e) => !toDelete.has(e.id));
  }

  return removed;
}

export function updateTrack(project, trackId, updates = {}) {
  const tracks = project.tracks || [];
  const track = tracks.find((t) => t.id === trackId);
  if (!track) {
    throw new Error(`Track "${trackId}" not found.`);
  }

  // The id is the key every entity points at; changing it would orphan them.
  const { id: _ignoredId, ...safeUpdates } = updates;
  Object.assign(track, safeUpdates);
  return track;
}