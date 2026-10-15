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
  const trackId = id || `track-${tracks.length + 1}`;

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

  // Also remove or re-assign any entities on this track
  if (project.entities) {
    project.entities = project.entities.filter((e) => e.trackId !== trackId);
  }

  return removed;
}

export function updateTrack(project, trackId, updates = {}) {
  const tracks = project.tracks || [];
  const track = tracks.find((t) => t.id === trackId);
  if (!track) {
    throw new Error(`Track "${trackId}" not found.`);
  }

  Object.assign(track, updates);
  return track;
}
