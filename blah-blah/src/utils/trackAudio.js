/**
 * Track-aware effective volume — the single place that combines a clip's
 * own volume with its track's mixer state (volume/mute/solo) into the one
 * number that should actually reach the speakers or the export mixdown.
 *
 * Why this exists: track.volume/track.muted have existed on the track data
 * shape for a while (see track-header mute button), but nothing downstream
 * ever read them — the live preview (EntityRenderer -> useMediaSync ->
 * mediaAudio.js) and the export mixdown (exportRunner.js) both only ever
 * looked at the clip's own AudioSource/VideoRenderer.volume. Muting a track
 * changed the button's own look and nothing else. This module is the fix:
 * both call sites now run every clip's volume through resolveEffectiveVolume
 * so a track's mixer state actually affects what's heard/exported.
 *
 * Solo semantics (standard DAW behavior): if ANY track is soloed, every
 * track that is NOT soloed is treated as silent, regardless of its own
 * mute/volume — soloing is a stronger override than mute. If no track is
 * soloed, mute/volume apply normally. A soloed track that is ALSO muted is
 * still silent (mute wins over solo for that one track) — this matches
 * every mainstream DAW's behavior and avoids a confusing "muted but I can
 * still hear it because I soloed it" state.
 */

/**
 * @param {number} clipVolume    The clip's own authored volume (AudioSource/
 *                                VideoRenderer.volume), already resolved by
 *                                the caller (e.g. `audioComp.volume ?? 1`).
 * @param {{ volume?: number, muted?: boolean, solo?: boolean }} [track]
 *                                The clip's owning track, or undefined/null
 *                                if the clip's trackId doesn't resolve to a
 *                                known track (treated as an unmixed track:
 *                                volume 1, not muted, not soloed).
 * @param {Array<{ id: string, solo?: boolean }>} [allTracks]
 *                                Every track in the project, used only to
 *                                determine whether ANY track is currently
 *                                soloed (this clip's own track may or may
 *                                not be among the soloed ones).
 * @returns {number} Effective volume to hand to setMediaElementVolume / the
 *                    export mixdown's GainNode. 0 means silent.
 */
export function resolveEffectiveVolume(clipVolume, track, allTracks) {
  const base = Number.isFinite(clipVolume) ? clipVolume : 1;
  if (base <= 0) return 0;

  const trackVolume = track && Number.isFinite(track.volume) ? track.volume : 1;
  if (trackVolume <= 0) return 0;
  if (track?.muted) return 0;

  const anySoloed = Array.isArray(allTracks) && allTracks.some((t) => t?.solo);
  if (anySoloed && !track?.solo) return 0;

  return base * trackVolume;
}

/**
 * Convenience lookup: find the track a clip/entity belongs to, from its
 * trackId, defaulting the same way the rest of the app does when a clip
 * predates the track system or its trackId doesn't resolve ('track-1').
 *
 * @param {{ trackId?: string }} entity
 * @param {Array<{ id: string }>} tracks
 */
export function findEntityTrack(entity, tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const trackId = entity?.trackId || 'track-1';
  return tracks.find((t) => t.id === trackId) || null;
}