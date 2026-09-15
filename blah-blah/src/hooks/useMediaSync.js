import { useEffect, useRef } from 'react';
import { setMediaElementVolume, setMediaElementRate, resumeAudioContext, disconnectMediaGainChain } from '../utils/mediaAudio';
 
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
 */
export function useMediaSync({ entities, activeVideoItems, computedEntities, currentTime, isPlaying }) {
  const videoRefs = useRef({});
  const audioRefs = useRef({});
  const wasPlayingRef = useRef(isPlaying);
 
  // Video — elements are created declaratively in JSX (ref callback sets
  // videoRefs.current[entity.id]); this effect only drives an existing element.
  useEffect(() => {
    const isStateTransition = wasPlayingRef.current !== isPlaying;
    wasPlayingRef.current = isPlaying;
 
    activeVideoItems.forEach(({ entity, transform }) => {
      const videoComp = entity.components.find((c) => c.type === 'VideoRenderer') || { src: entity.src };
      const vidSrc = videoComp.src || entity.src;
      if (!vidSrc) return;
 
      const vidEl = videoRefs.current[entity.id];
      if (vidEl) {
        const speed = (videoComp.speed || 1) * (transform?.speed ?? 1);
        const offset = videoComp.mediaOffset || 0;
        const localTime = (currentTime - entity.startTime) * speed + offset;
 
        // Default video volume to 0 (silent) — a video clip's audio is
        // owned by its linked AudioSource entity (handleAddMediaToTimeline
        // mutes the video and pairs it with one). This matches the export
        // mixdown (exportRunner.js collectAudioSources defaults
        // VideoRenderer volume to 0) so a video without an explicit volume
        // never plays its own audio track in preview, and a volume slider
        // on the video clip never silently does nothing.
        setMediaElementVolume(vidEl, videoComp.volume ?? 0);
        setMediaElementRate(vidEl, speed);
 
        if (isPlaying) {
          resumeAudioContext();
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
 
    // Pause any videos outside the active timeline window
    Object.keys(videoRefs.current).forEach((id) => {
      if (!activeVideoItems.some(({ entity }) => entity.id === id)) {
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
  }, [currentTime, isPlaying, activeVideoItems, entities]);
 
  // Audio — same rate/volume/seek treatment as video above, but audio
  // elements are created imperatively here (no <audio> in JSX) since
  // there's nothing to render for them.
  useEffect(() => {
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
        setMediaElementVolume(aud, audioComp.volume ?? 1);
        setMediaElementRate(aud, speed);
 
        if (isPlaying) {
          resumeAudioContext();
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
  }, [currentTime, isPlaying, computedEntities, entities]);
 
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
 