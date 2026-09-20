import { memo } from 'react';
import { Volume2, VolumeX, Plus } from 'lucide-react';
import { resolveEffectiveVolume } from '../../utils/trackAudio';
import './mixer-panel.css';

// Fader range. Tracks share the same 0–4 volume range as clip-level
// AudioSource/VideoRenderer.volume (see TRANSFORM_FIELD_GROUPS' speed field
// for the sibling convention of "1 is unity/100%, headroom above that"), so
// a track fader and a clip's own volume knob read the same way.
const FADER_MIN = 0;
const FADER_MAX = 4;
const FADER_STEP = 0.01;

/**
 * One channel strip for a single track: name, an "Add Plugin" slot
 * (VST/effects — inert placeholder for now, see the future-scope note
 * below), a vertical volume fader, and Mute/Solo buttons.
 *
 * isSilenced reflects the ACTUAL effective outcome for this track (via
 * resolveEffectiveVolume — the same function the live preview and export
 * mixdown both run every clip's volume through), not just this track's own
 * .muted flag — so a track that isn't muted but is silenced because some
 * OTHER track is soloed still visibly dims here, matching what you'd
 * actually hear.
 */
const MixerStrip = memo(function MixerStrip({ track, allTracks, onUpdateTrack }) {
  const volume = Number.isFinite(track.volume) ? track.volume : 1;
  const isSilenced = resolveEffectiveVolume(1, track, allTracks) <= 0;

  return (
    <div className={`mixer-strip ${isSilenced ? 'is-silenced' : ''}`}>
      <div className="mixer-strip-name" title={track.name}>{track.name}</div>

      {/* VST/effects slot — future scope, see plan. Placeholder only: not
          wired to anything, communicates where plugins will eventually
          slot in without promising functionality that doesn't exist yet. */}
      <button
        type="button"
        className="mixer-strip-plugin-slot"
        title="Plugin slots (VST support planned — not available yet)"
        disabled
      >
        <Plus size={10} />
      </button>

      <div className="mixer-fader-row">
        <div className="mixer-fader-track">
          <input
            type="range"
            className="mixer-fader-input"
            min={FADER_MIN}
            max={FADER_MAX}
            step={FADER_STEP}
            value={volume}
            onChange={(e) => onUpdateTrack(track.id, { volume: parseFloat(e.target.value) })}
            title={`Volume: ${Math.round(volume * 100)}%`}
          />
        </div>
      </div>
      <div className="mixer-fader-value">{Math.round(volume * 100)}%</div>

      <div className="mixer-strip-buttons">
        <button
          type="button"
          className={`mixer-btn mixer-btn-mute ${track.muted ? 'active' : ''}`}
          title={track.muted ? 'Unmute Track' : 'Mute Track'}
          onClick={() => onUpdateTrack(track.id, { muted: !track.muted })}
        >
          {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
        </button>
        <button
          type="button"
          className={`mixer-btn mixer-btn-solo ${track.solo ? 'active' : ''}`}
          title={track.solo ? 'Unsolo Track' : 'Solo Track'}
          onClick={() => onUpdateTrack(track.id, { solo: !track.solo })}
        >
          S
        </button>
      </div>
    </div>
  );
});

/**
 * MixerPanel — Dockable Panel, DAW-style mixer view of every track:
 * one vertical channel strip per track with Volume/Mute/Solo. Mirrors the
 * same track-header controls (see components/Timeline/TrackHeader.jsx) in
 * a dedicated view for adjusting many tracks' levels side by side instead
 * of hunting for each one's row on the timeline.
 *
 * Solo follows standard DAW semantics: soloing ANY track silences every
 * non-soloed track, mute always wins over solo for that track. See
 * utils/trackAudio.js#resolveEffectiveVolume for the shared logic that
 * also drives live playback and export, so this panel's dimmed/lit state
 * always matches what's actually audible.
 *
 * VST/plugin slots are visible per-strip as a disabled placeholder only —
 * no hosting exists yet (see project plan: Tauri + a Rust VST3 host is
 * future scope, tracked separately from this panel).
 */
export const MixerPanel = memo(function MixerPanel({
  tracks = [],
  onUpdateTrack,
}) {
  if (!tracks || tracks.length === 0) {
    return <div className="mixer-panel-empty">No tracks yet — add a track to see it here.</div>;
  }

  return (
    <div className="mixer-panel">
      {tracks.map((track) => (
        <MixerStrip
          key={track.id}
          track={track}
          allTracks={tracks}
          onUpdateTrack={onUpdateTrack}
        />
      ))}
    </div>
  );
});