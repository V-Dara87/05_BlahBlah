import { memo, useCallback, useEffect, useRef } from 'react';
import { Volume2, VolumeX, Plus } from 'lucide-react';
import { resolveEffectiveVolume } from '../../utils/trackAudio';
import { getTrackPeakDb, METER_FLOOR_DB } from '../../utils/mediaAudio';
import {
  FADER_MAX_DB,
  FADER_MIN_DB,
  UNITY_FADER_POS,
  dbToMeterFill,
  faderPosToGain,
  formatGainDb,
  formatPeakDb,
  gainToFaderPos,
  meterZone,
  snapToUnity,
} from '../../utils/mixerMath';
import './mixer-panel.css';
 
// Meter geometry. The scale runs from METER_FLOOR_DB (-60) up to +6 dBFS so
// there's visible room ABOVE the 0 dB line — that's where clipping shows.
// 33 segments over 66 dB is exactly 2 dB per segment, which puts a segment
// EDGE precisely on 0 dBFS: the red zone starts exactly at 0, not "near" it,
// and doesn't depend on rounding. Keep (CEIL - FLOOR) / COUNT a whole number
// that divides FLOOR's distance to 0 if you change either.
const METER_CEIL_DB = 6;
const SEGMENT_COUNT = 33;
const SEGMENT_DB = (METER_CEIL_DB - METER_FLOOR_DB) / SEGMENT_COUNT;
// How long the peak-hold tick stays before it starts to fall, and how fast
// it falls afterwards (dB per second).
const PEAK_HOLD_MS = 1200;
const PEAK_FALL_DB_PER_SEC = 18;
// The bar itself falls smoothly instead of snapping (dB per second).
const BAR_FALL_DB_PER_SEC = 60;
 
// Scale labels drawn beside the fader/meter. "0" is the unity / full-scale
// line and gets special styling.
const SCALE_MARKS = [6, 0, -6, -12, -24, -48];
 
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
 
// Vertical position (0 = bottom, 1 = top) of a dBFS value on the METER.
const meterPosOfDb = (db) => dbToMeterFill(db, METER_FLOOR_DB, METER_CEIL_DB);
const METER_ZERO_POS = meterPosOfDb(0);
 
// Vertical position of a dB value on the FADER (its own dB range).
const faderPosOfDb = (db) =>
  clamp01((db - FADER_MIN_DB) / (FADER_MAX_DB - FADER_MIN_DB));
 
/**
 * The segmented LED-style meter for one strip.
 *
 * PERFORMANCE: this component renders exactly once. All the per-frame work
 * (reading the analyser, moving the bar, peak-hold, clip lamp) is done by
 * imperatively writing to DOM refs from the panel's single shared
 * requestAnimationFrame loop — putting a 60 fps signal through React state
 * would re-render every strip 60 times a second for no reason.
 */
const Meter = memo(function Meter({ meterRef }) {
  const segments = [];
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    // Colour a segment by its BOTTOM edge: segment 30 spans 0..+2 dB, so it
    // (and everything above it) is red, while the one below it spans -2..0
    // dB and stays in the "hot" zone. Lit-ness is decided separately in the
    // animation loop (a segment lights once the level reaches its bottom
    // edge, i.e. as soon as the signal enters its dB span).
    const bottomDb = METER_FLOOR_DB + i * SEGMENT_DB;
    segments.push(<i key={i} className={`mixer-seg zone-${meterZone(bottomDb)}`} />);
  }
 
  return (
    <div className="mixer-meter" ref={meterRef}>
      <div className="mixer-meter-segs" data-el="segs">{segments}</div>
      <div className="mixer-meter-peak" data-el="peak" />
      <div
        className="mixer-meter-zero"
        style={{ bottom: `${METER_ZERO_POS * 100}%` }}
        title="0 dBFS — full scale. Above this line the signal clips."
      />
    </div>
  );
});
 
/**
 * Vertical dB fader. Pointer-driven (with pointer capture, so a drag keeps
 * tracking outside the element), double-click resets to 0 dB, dragging
 * magnets to 0 dB, and the arrow keys / Home / End work for keyboard use.
 *
 * The stored value is still the linear 0–4 gain multiplier; only the
 * gesture and readout are in dB (see utils/mixerMath.js).
 */
const Fader = memo(function Fader({ volume, onChange }) {
  const railRef = useRef(null);
  const draggingRef = useRef(false);
 
  const commitFromClientY = useCallback(
    (clientY) => {
      const rail = railRef.current;
      if (!rail) return;
      const rect = rail.getBoundingClientRect();
      if (rect.height <= 0) return;
      const pos = clamp01(1 - (clientY - rect.top) / rect.height);
      onChange(snapToUnity(faderPosToGain(pos)));
    },
    [onChange],
  );
 
  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    commitFromClientY(e.clientY);
  };
  const onPointerMove = (e) => {
    if (draggingRef.current) commitFromClientY(e.clientY);
  };
  const endDrag = (e) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
 
  const onKeyDown = (e) => {
    const pos = gainToFaderPos(volume);
    const step = e.shiftKey ? 0.05 : 0.01;
    let next = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = pos + step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = pos - step;
    else if (e.key === 'Home') next = UNITY_FADER_POS;
    else if (e.key === 'End') next = 1;
    else if (e.key === 'PageDown') next = 0;
    if (next === null) return;
    e.preventDefault();
    onChange(snapToUnity(faderPosToGain(clamp01(next))));
  };
 
  const pos = gainToFaderPos(volume);
  const overUnity = volume > 1.0000001;
 
  return (
    <div
      className="mixer-fader"
      ref={railRef}
      role="slider"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Track volume"
      aria-valuemin={FADER_MIN_DB}
      aria-valuemax={Math.round(FADER_MAX_DB * 10) / 10}
      aria-valuenow={Number.isFinite(volume) && volume > 0 ? Math.round(20 * Math.log10(volume) * 10) / 10 : FADER_MIN_DB}
      aria-valuetext={`${formatGainDb(volume)} dB`}
      title="Drag to set level · double-click to reset to 0 dB"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onChange(1)}
      onKeyDown={onKeyDown}
    >
      <div className="mixer-fader-rail" />
      <div className="mixer-fader-fill" style={{ height: `${pos * 100}%` }} />
      <div
        className="mixer-fader-unity"
        style={{ bottom: `${UNITY_FADER_POS * 100}%` }}
      />
      <div
        className={`mixer-fader-cap ${overUnity ? 'is-boosted' : ''}`}
        style={{ bottom: `${pos * 100}%` }}
      />
    </div>
  );
});
 
/**
 * One channel strip: name, plugin slot (inert placeholder), clip lamp +
 * peak readout, fader with a dB scale next to a live meter, the fader's dB
 * value, and Mute / Solo.
 *
 * isSilenced reflects the ACTUAL effective outcome for this track (via
 * resolveEffectiveVolume — the same function live preview and export both
 * use), so a track silenced only because ANOTHER track is soloed dims here
 * too, matching what you'd really hear.
 */
const MixerStrip = memo(function MixerStrip({
  track,
  allTracks,
  onUpdateTrack,
  registerStrip,
}) {
  const volume = Number.isFinite(track.volume) ? track.volume : 1;
  const isSilenced = resolveEffectiveVolume(1, track, allTracks) <= 0;
 
  const stripRef = useRef(null);
  const meterRef = useRef(null);
  const clipRef = useRef(null);
  const readoutRef = useRef(null);
  const clearClipRef = useRef(false);
 
  // Hand this strip's DOM nodes to the panel's animation loop, keyed by
  // track id, and unregister on unmount / id change.
  useEffect(() => {
    registerStrip(track.id, { strip: stripRef, meter: meterRef, clip: clipRef, readout: readoutRef, clearClip: clearClipRef });
    return () => registerStrip(track.id, null);
  }, [track.id, registerStrip]);
 
  const handleFader = useCallback(
    (gain) => onUpdateTrack(track.id, { volume: gain }),
    [onUpdateTrack, track.id],
  );
 
  // The animation loop owns the latch. Clicking just raises a flag the loop
  // consumes on its next frame (and clears the lamp immediately so the
  // click feels instant even if the tab is throttled).
  const resetClip = () => {
    clearClipRef.current = true;
    clipRef.current?.classList.remove('is-clipped');
  };
 
  return (
    <div ref={stripRef} className={`mixer-strip ${isSilenced ? 'is-silenced' : ''}`}>
      <div className="mixer-strip-name" title={track.name}>{track.name}</div>
 
      {/* VST/effects slot — future scope. Placeholder only: not wired to
          anything, shows where plugins will eventually slot in without
          promising functionality that doesn't exist yet. */}
      <button
        type="button"
        className="mixer-strip-plugin-slot"
        title="Plugin slots (VST support planned — not available yet)"
        disabled
      >
        <Plus size={10} />
      </button>
 
      <button
        type="button"
        ref={clipRef}
        className="mixer-clip"
        title="Clip indicator — lights red when the signal hits 0 dBFS or above. Click to clear."
        onClick={resetClip}
      >
        <span ref={readoutRef} className="mixer-clip-readout">-inf</span>
      </button>
 
      <div className="mixer-fader-row">
        <div className="mixer-scale" aria-hidden="true">
          {SCALE_MARKS.map((db) => (
            <span
              key={db}
              className={`mixer-scale-mark ${db === 0 ? 'is-zero' : ''}`}
              style={{ bottom: `${meterPosOfDb(db) * 100}%` }}
            >
              {db > 0 ? `+${db}` : db}
            </span>
          ))}
        </div>
        <Meter meterRef={meterRef} />
        <Fader volume={volume} onChange={handleFader} />
      </div>
 
      <div className={`mixer-fader-value ${volume > 1.0000001 ? 'is-boosted' : ''}`}>
        {formatGainDb(volume)}
        <span className="mixer-fader-unit"> dB</span>
      </div>
 
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
 * MixerPanel — Dockable Panel, DAW-style mixer: one vertical channel strip
 * per track with a dB fader, live level meter, Mute and Solo.
 *
 * LEVELS ARE REAL. Each strip's meter reads the post-fader signal that is
 * actually being sent to the speakers (see getTrackPeakDb in
 * utils/mediaAudio.js), so it responds to the fader, mute and solo. When
 * the transport is stopped nothing is playing and the meters rest at
 * silence — that's correct, not a bug.
 *
 * Solo follows standard DAW semantics: soloing ANY track silences every
 * non-soloed track; mute always wins over solo for that track. See
 * utils/trackAudio.js#resolveEffectiveVolume, which also drives live
 * playback and export.
 *
 * One requestAnimationFrame loop for the whole panel drives every meter by
 * writing to DOM nodes directly (no per-frame React state). It only runs
 * while the panel is mounted AND the tab is visible.
 */
export const MixerPanel = memo(function MixerPanel({
  tracks = [],
  onUpdateTrack,
}) {
  // trackId -> { strip, meter, clip, readout } refs, plus per-strip meter
  // animation state (kept in a ref so it survives without re-rendering).
  const stripsRef = useRef(new Map());
 
  const registerStrip = useCallback((trackId, refs) => {
    if (refs) stripsRef.current.set(trackId, refs);
    else stripsRef.current.delete(trackId);
  }, []);
 
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    // Per-track animation state: { level, peak, peakAt, clipped }
    const states = new Map();
 
    const tick = (now) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
 
      for (const [trackId, refs] of stripsRef.current) {
        const meterEl = refs.meter.current;
        if (!meterEl) continue;
 
        let st = states.get(trackId);
        if (!st) {
          st = { level: METER_FLOOR_DB, peak: METER_FLOOR_DB, peakAt: 0, clipped: false };
          states.set(trackId, st);
        }
 
        const raw = getTrackPeakDb(trackId);
 
        // Bar: instant attack, smooth release.
        if (raw >= st.level) st.level = raw;
        else st.level = Math.max(raw, st.level - BAR_FALL_DB_PER_SEC * dt);
 
        // Peak hold: sticks, then falls.
        if (raw >= st.peak) {
          st.peak = raw;
          st.peakAt = now;
        } else if (now - st.peakAt > PEAK_HOLD_MS) {
          st.peak = Math.max(raw, st.peak - PEAK_FALL_DB_PER_SEC * dt);
        }
 
        // Clip latch: any sample at/above 0 dBFS lights the lamp until the
        // user clears it (click) — so a brief over isn't missed.
        if (refs.clearClip.current) {
          st.clipped = false;
          refs.clearClip.current = false;
        }
        if (raw >= 0) st.clipped = true;
 
        // ---- write to the DOM ----
        const segs = meterEl.querySelector('[data-el="segs"]');
        if (segs) {
          const kids = segs.children;
          for (let i = 0; i < kids.length; i++) {
            // Lit once the level reaches the segment's bottom edge. (A
            // level of exactly 0 dBFS therefore lights segment 30, the
            // first red one.) Strictly above the floor so silence is dark.
            const on = st.level > METER_FLOOR_DB && st.level >= METER_FLOOR_DB + i * SEGMENT_DB;
            if (kids[i].classList.contains('on') !== on) kids[i].classList.toggle('on', on);
          }
        }
 
        const peakEl = meterEl.querySelector('[data-el="peak"]');
        if (peakEl) {
          const pPos = meterPosOfDb(st.peak);
          peakEl.style.bottom = `${pPos * 100}%`;
          peakEl.style.opacity = st.peak <= METER_FLOOR_DB ? '0' : '1';
          peakEl.dataset.zone = meterZone(st.peak);
        }
 
        const clipEl = refs.clip.current;
        if (clipEl) {
          if (clipEl.classList.contains('is-clipped') !== st.clipped) {
            clipEl.classList.toggle('is-clipped', st.clipped);
          }
        }
 
        const readEl = refs.readout.current;
        if (readEl) {
          const text = formatPeakDb(st.peak);
          if (readEl.textContent !== text) readEl.textContent = text;
        }
      }
 
      raf = requestAnimationFrame(tick);
    };
 
    const start = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    // Don't burn frames while the window is hidden.
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    start();
 
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, []);
 
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
          registerStrip={registerStrip}
        />
      ))}
    </div>
  );
});