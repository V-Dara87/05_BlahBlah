import { useEffect, useRef } from 'react';
import { setMediaElementVolume, setMediaElementRate, resumeAudioContext, disconnectMediaGainChain } from '../utils/mediaAudio';
import { resolveEffectiveVolume, findEntityTrack } from '../utils/trackAudio';
import { resolveTransitionAudioForEntity } from '../engine/renderPipeline';
 
/**
 * Keeps <video>/<audio> elements glued to the timeline during playback and
 * scrubbing. Pulled out of EntityRenderer.jsx, where the video and audio
 * branches were two near-identical ~55-line effects (same rate/volume/seek
 * logic, same "pause and clean up elements whose entity is gone" tail) —
 * this is that logic once, parameterized by which element map/active-items
 * list it's syncing.
 *
 * Effective media rate = <kind>Renderer.speed (content rate inside the
 * clip) × Transform.speed (clip-level rate, the timeline-speed feature).
 * Volume is applied through a Web Audio GainNode chain (see
 * utils/mediaAudio.js) so it can exceed 1.0 — element.volume is clamped to
 * [0,1] by the platform.
 *
 * Volume ALSO now factors in the clip's owning track's mixer state
 * (volume/mute/solo — see utils/trackAudio.js) before it ever reaches
 * setMediaElementVolume. Previously a track's own volume/muted fields sat
 * on the data unused here — muting a track only changed the track-header
 * button's look, the audio kept playing. tracks is a new required param
 * for exactly this; every existing caller (EntityRenderer.jsx) already has
 * tracks in scope, so this is a same-file two-line change at the call site.
 *
 * FIXED — silent preview on play: resumeAudioContext() is now awaited
 * BEFORE the element is routed through the gain chain (setMediaElementVolume)
 * and before play() is called. Previously resumeAudioContext() was fired
 * off without waiting right after volume/routing had already happened, so
 * play() could start while the shared AudioContext was still 'suspended' —
 * the element would visibly play (currentTime advancing) with no audible
 * sound until something else happened to resume the context later. See
 * utils/mediaAudio.js for the full explanation.
 */
export function useMediaSync({ entities, activeVideoItems, computedEntities, currentTime, isPlaying, tracks = [], transitionPlan = null, transitionAudioWindows = null }) {
  const videoRefs = useRef({});
  const audioRefs = useRef({});
  const wasPlayingRef = useRef(isPlaying);
  // Step 5: entities keyed by id, for resolveTransitionAudioForEntity's
  // parent fallback (an AudioSource child clip fades with its video
  // parent). Cheap to rebuild each effect run; entities is already the
  // full list both effects below iterate.
  const entityMapRef = useRef(new Map());
  entityMapRef.current = new Map((entities || []).map((e) => [e.id, e]));
 
  // Video — elements are created declaratively in JSX (ref callback sets
  // videoRefs.current[entity.id]); this effect only drives an existing element.
  useEffect(() => {
    const isStateTransition = wasPlayingRef.current !== isPlaying;
    wasPlayingRef.current = isPlaying;
 
    // TransitionClips: while one is active, its neighbours A and B must both
    // keep playing/seeking even though one of them is OUTSIDE its own clip
    // window (so it is not in activeVideoItems). Add the missing side(s) and
    // give each the resolver's EXTENDED media time + rate (transitionPlan.
    // seekTimes, the same numbers export seeks to) instead of the normal
    // (currentTime − startTime) × speed + offset. For a side that is inside
    // its own window the two are identical, so B does not jump at the cut.
    // With no active transition clip transitionPlan.seekTimes is empty and
    // syncItems === activeVideoItems: behaviour is unchanged.
    const seekTimes = transitionPlan?.seekTimes;
    let syncItems = activeVideoItems;
    if (seekTimes && seekTimes.size > 0) {
      const present = new Set(activeVideoItems.map(({ entity }) => entity.id));
      const extra = [];
      for (const t of transitionPlan.transitions) {
        for (const side of [t.from, t.to]) {
          if (!side || present.has(side.entity.id)) continue;
          present.add(side.entity.id);
          extra.push({ entity: side.entity, transform: null });
        }
      }
      if (extra.length) syncItems = [...activeVideoItems, ...extra];
    }
 
    // Resume the shared AudioContext FIRST and wait for it to actually be
    // running before routing/playing anything this tick. Cheap no-op when
    // already running; see utils/mediaAudio.js for why the ordering matters.
    const startPlayback = async () => {
      if (isPlaying) {
        await resumeAudioContext();
      }
 
      syncItems.forEach(({ entity, transform }) => {
        const videoComp = entity.components.find((c) => c.type === 'VideoRenderer') || { src: entity.src };
        const vidSrc = videoComp.src || entity.src;
        if (!vidSrc) return;
 
        const vidEl = videoRefs.current[entity.id];
        if (vidEl) {
          const ext = seekTimes?.get(entity.id);
          const speed = ext ? ext.rate : (videoComp.speed || 1) * (transform?.speed ?? 1);
          const offset = videoComp.mediaOffset || 0;
          const localTime = ext ? ext.mediaTime : (currentTime - entity.startTime) * speed + offset;
 
          // Default video volume to 0 (silent) — a video clip's audio is
          // owned by its linked AudioSource entity (handleAddMediaToTimeline
          // mutes the video and pairs it with one). This matches the export
          // mixdown (exportRunner.js collectAudioSources defaults
          // VideoRenderer volume to 0) so a video without an explicit volume
          // never plays its own audio track in preview, and a volume slider
          // on the video clip never silently does nothing.
          const track = findEntityTrack(entity, tracks);
          let effectiveVolume = resolveEffectiveVolume(videoComp.volume ?? 0, track, tracks);
          // Step 5: crossfade A/B's own gain across a transition window
          // touching this clip, same 0..1 envelope the export mixdown
          // applies (getTransitionAudioWindows in renderPipeline.js) — so
          // scrubbing/playing across a cut sounds like the picture blends,
          // not an abrupt swap. No-op (gainAt undefined) for any clip not
          // touching a transition.
          const videoTransitionAudio = resolveTransitionAudioForEntity(entity, transitionAudioWindows, entityMapRef.current);
          if (videoTransitionAudio) effectiveVolume *= videoTransitionAudio.gainAt(currentTime);
          setMediaElementVolume(vidEl, effectiveVolume, track?.id);
          setMediaElementRate(vidEl, speed);
 
          if (isPlaying) {
            if (vidEl.paused || isStateTransition || Math.abs(vidEl.currentTime - localTime) > 0.6) {
              vidEl.currentTime = Math.max(0, localTime);
              vidEl.play().catch(() => {});
            }
          } else {
            if (!vidEl.paused) vidEl.pause();
            if (Math.abs(vidEl.currentTime - localTime) > 0.05) {
              vidEl.currentTime = Math.max(0, localTime);
            }
          }
        }
      });
    };
 
    startPlayback();
 
    // Pause any videos outside the active timeline window
    Object.keys(videoRefs.current).forEach((id) => {
      if (!syncItems.some(({ entity }) => entity.id === id)) {
        const el = videoRefs.current[id];
        if (el && !el.paused) el.pause();
      }
      // Clean up videos whose entity was deleted from the project
      if (!entities.some((e) => e.id === id)) {
        const el = videoRefs.current[id];
        if (el) {
          if (!el.paused) el.pause();
          disconnectMediaGainChain(el);
        }
        delete videoRefs.current[id];
      }
    });
  }, [currentTime, isPlaying, activeVideoItems, entities, tracks, transitionPlan, transitionAudioWindows]);
 
  // Audio — same rate/volume/seek treatment as video above, but audio
  // elements are created imperatively here (no <audio> in JSX) since
  // there's nothing to render for them.
  useEffect(() => {
    const startPlayback = async () => {
      if (isPlaying) {
        await resumeAudioContext();
      }
 
      computedEntities.forEach(({ entity, transform }) => {
        const audioComp =
          entity.components.find((c) => c.type === 'AudioSource') ||
          (entity.type === 'audio' ? { src: entity.src } : null);
        if (audioComp && audioComp.src) {
          let aud = audioRefs.current[entity.id];
          if (!aud) {
            aud = new Audio();
            aud.crossOrigin = 'anonymous';
            aud.src = audioComp.src;
            audioRefs.current[entity.id] = aud;
          } else if (aud.src !== audioComp.src) {
            aud.crossOrigin = 'anonymous';
            aud.src = audioComp.src;
          }
 
          const speed = (audioComp.speed || 1) * (transform?.speed ?? 1);
          const offset = audioComp.mediaOffset || 0;
          const localTime = (currentTime - entity.startTime) * speed + offset;
          const track = findEntityTrack(entity, tracks);
          let effectiveVolume = resolveEffectiveVolume(audioComp.volume ?? 1, track, tracks);
          // Step 5: same crossfade as the video branch above. This entity
          // may itself be an AudioSource child of a video clip that is the
          // A/B side of a transition (handleAddMediaToTimeline: "Audio is
          // ALWAYS child of video") — resolveTransitionAudioForEntity's
          // parent-id fallback covers that case as well as a bare audio
          // clip that happens to be a transition side directly.
          const audioTransitionAudio = resolveTransitionAudioForEntity(entity, transitionAudioWindows, entityMapRef.current);
          if (audioTransitionAudio) effectiveVolume *= audioTransitionAudio.gainAt(currentTime);
          setMediaElementVolume(aud, effectiveVolume, track?.id);
          setMediaElementRate(aud, speed);
 
          if (isPlaying) {
            if (aud.paused || Math.abs(aud.currentTime - localTime) > 0.6) {
              aud.currentTime = Math.max(0, localTime);
              aud.play().catch(() => {});
            }
          } else {
            if (!aud.paused) aud.pause();
            if (Math.abs(aud.currentTime - localTime) > 0.05) {
              aud.currentTime = Math.max(0, localTime);
            }
          }
        }
      });
    };
 
    startPlayback();
 
    Object.keys(audioRefs.current).forEach((id) => {
      if (!computedEntities.some(({ entity }) => entity.id === id)) {
        const aud = audioRefs.current[id];
        if (aud && !aud.paused) aud.pause();
      }
      // Clean up audio elements whose entity was deleted from the project
      if (!entities.some((e) => e.id === id)) {
        const aud = audioRefs.current[id];
        if (aud) {
          if (!aud.paused) aud.pause();
          disconnectMediaGainChain(aud);
        }
        delete audioRefs.current[id];
      }
    });
  }, [currentTime, isPlaying, computedEntities, entities, tracks, transitionAudioWindows]);
 
  // Cleanup on unmount — stop and disconnect every element this hook
  // ever created/tracked (mirrors EntityRenderer's own unmount cleanup,
  // now scoped to just the elements this hook owns).
  useEffect(() => {
    return () => {
      Object.values(audioRefs.current).forEach((aud) => {
        if (aud) {
          if (!aud.paused) aud.pause();
          disconnectMediaGainChain(aud);
        }
      });
      Object.values(videoRefs.current).forEach((vid) => {
        if (vid) {
          if (!vid.paused) vid.pause();
          disconnectMediaGainChain(vid);
        }
      });
    };
  }, []);
 
  return { videoRefs, audioRefs };
}