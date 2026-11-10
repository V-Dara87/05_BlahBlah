/**
 * App-level owner of VST3 preview, editor sessions and wet-bounce state.
 *
 * Mounted once in App so preview works even when the Mixer is closed. Audio is
 * driven by the playback store's frame loop and plain Audio elements, not by
 * React state; the external trackFxStore only changes when a bounce finishes.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  bounceTrackFx,
  clearVstCache,
  editFxSlot,
  pruneVstCache,
} from '../services/trackFxBounce';
import { isFxChainActive } from '../utils/fxChain';
import {
  clearTrackFxEntry,
  getTrackFxState,
  setTrackFxActions,
  setTrackFxEntry,
} from '../utils/trackFxStore';
import { disconnectMediaGainChain, resumeAudioContext, setMediaElementVolume } from '../utils/mediaAudio';
import { resolveEffectiveVolume } from '../utils/trackAudio';

export function useTrackFx({
  tracks,
  entities,
  mediaAssets,
  projectFolderHandle,
  vstEnabled,
  playbackStoreRef,
  onUpdateTrack,
  sampleRate = 48000,
}) {
  const audioRefs = useRef(new Map());
  const tracksRef = useRef(tracks);
  const entitiesRef = useRef(entities);
  const mediaAssetsRef = useRef(mediaAssets);
  const projectRef = useRef(projectFolderHandle);
  const enabledRef = useRef(vstEnabled);
  const onUpdateRef = useRef(onUpdateTrack);
  const queueRef = useRef([]);
  const runningRef = useRef(false);
  const generationRef = useRef(0);

  tracksRef.current = tracks;
  entitiesRef.current = entities;
  mediaAssetsRef.current = mediaAssets;
  projectRef.current = projectFolderHandle;
  enabledRef.current = vstEnabled;
  onUpdateRef.current = onUpdateTrack;

  const fxSignature = useMemo(
    () => (tracks || []).map((track) => `${track.id}:${track.fxBypassAll ? 1 : 0}:${JSON.stringify(track.fx || [])}`).join('|'),
    [tracks]
  );

  const runQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const job = queueRef.current.shift();
        if (!job || job.generation !== generationRef.current) continue;
        const { track, kind, playhead } = job;
        setTrackFxEntry(track.id, {
          ...(getTrackFxState().byTrack[track.id] || {}),
          active: false,
          status: kind === 'audition' ? 'auditioning' : 'bouncing',
          kind,
        });
        try {
          const result = await bounceTrackFx({
            track,
            entities: entitiesRef.current,
            mediaAssets: mediaAssetsRef.current,
            projectFolderHandle: projectRef.current,
            sampleRate,
            kind,
            playhead,
          });
          if (job.generation !== generationRef.current) continue;
          if (!result) {
            setTrackFxEntry(track.id, { active: false, status: 'dry', kind });
            continue;
          }
          setTrackFxEntry(track.id, {
            active: true,
            status: 'ready',
            kind,
            path: result.path,
            cacheKey: result.cacheKey,
            startTime: result.startTime,
            duration: result.duration,
            warnings: result.warnings || [],
          });
          const limitMb = 2048;
          pruneVstCache(limitMb * 1024 * 1024).catch(() => {});
        } catch (error) {
          if (job.generation !== generationRef.current) continue;
          console.warn(`VST preview bounce failed for ${track.name}:`, error);
          setTrackFxEntry(track.id, {
            active: false,
            status: 'error',
            kind,
            error: error?.message || String(error),
          });
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [sampleRate]);

  const enqueue = useCallback((track, kind, playhead) => {
    queueRef.current.push({ track, kind, playhead, generation: generationRef.current });
    runQueue();
  }, [runQueue]);

  const requestTrack = useCallback((trackId, kind = 'full') => {
    const track = tracksRef.current?.find((item) => item.id === trackId);
    if (!track || !enabledRef.current || !isFxChainActive(track)) return;
    enqueue(track, kind, playbackStoreRef.current?.getCurrentTime?.() ?? 0);
  }, [enqueue, playbackStoreRef]);

  const openEditor = useCallback(async (trackId, slotId) => {
    const track = tracksRef.current?.find((item) => item.id === trackId);
    const slot = track?.fx?.find((item) => item.id === slotId);
    if (!track || !slot) return null;
    try {
      const result = await editFxSlot({
        projectFolderHandle: projectRef.current,
        track,
        slot,
      });
      if (result && onUpdateRef.current) {
        // One track update for the whole editor session -> one undo step.
        onUpdateRef.current(track.id, {
          fx: track.fx.map((item) => (item.id === slot.id ? { ...item, ...result } : item)),
        });
      }
      return result;
    } catch (error) {
      console.warn('VST editor failed:', error);
      throw error;
    }
  }, []);

  const bounceNow = useCallback((trackId) => {
    generationRef.current += 1;
    queueRef.current = [];
    requestTrack(trackId, 'full');
  }, [requestTrack]);

  const audition = useCallback((trackId) => {
    generationRef.current += 1;
    queueRef.current = [];
    requestTrack(trackId, 'audition');
  }, [requestTrack]);

  const clearCache = useCallback(async () => {
    await clearVstCache();
    for (const track of tracksRef.current || []) {
      if (isFxChainActive(track)) clearTrackFxEntry(track.id);
    }
  }, []);

  // Queue one full bounce per changed chain. Debounced so dragging clips does
  // not start a new render on every pointer move.
  useEffect(() => {
    if (!vstEnabled || !projectFolderHandle) {
      for (const track of tracksRef.current || []) clearTrackFxEntry(track.id);
      return undefined;
    }
    const timer = setTimeout(() => {
      generationRef.current += 1;
      queueRef.current = [];
      const generation = generationRef.current;
      for (const track of tracksRef.current || []) {
        if (!isFxChainActive(track)) {
          clearTrackFxEntry(track.id);
          continue;
        }
        queueRef.current.push({ track, kind: 'full', playhead: 0, generation });
      }
      runQueue();
    }, 550);
    return () => clearTimeout(timer);
  }, [fxSignature, entities, mediaAssets, projectFolderHandle, vstEnabled, runQueue]);

  // One rAF loop for every wet element. No React state is touched here.
  useEffect(() => {
    let raf = 0;
    let lastResume = 0;
    const tick = () => {
      const store = playbackStoreRef.current;
      const time = store?.getCurrentTime?.() ?? 0;
      const playing = store?.getIsPlaying?.() ?? false;
      const tracksNow = tracksRef.current || [];
      const byTrack = getTrackFxState().byTrack;

      for (const [trackId, entry] of Object.entries(byTrack)) {
        if (!entry?.active || !entry.path) continue;
        let aud = audioRefs.current.get(trackId);
        if (!aud) {
          aud = new Audio();
          aud.preload = 'auto';
          audioRefs.current.set(trackId, aud);
        }
        if (aud.__bbFxPath !== entry.path) {
          aud.src = convertFileSrc(entry.path);
          aud.__bbFxPath = entry.path;
          aud.__bbFxGain = undefined;
        }
        const track = tracksNow.find((item) => item.id === trackId);
        const gain = resolveEffectiveVolume(1, track, tracksNow);
        if (aud.__bbFxGain !== gain) {
          setMediaElementVolume(aud, gain, trackId);
          aud.__bbFxGain = gain;
        }
        const local = time - entry.startTime;
        const inRange = local >= 0 && local < entry.duration;
        if (playing && inRange) {
          if (playing && Date.now() - lastResume > 1500) {
            resumeAudioContext().catch(() => {});
            lastResume = Date.now();
          }
          if (aud.paused) {
            if (Math.abs(aud.currentTime - local) > 0.05) aud.currentTime = local;
            aud.play().catch(() => {});
          } else if (Math.abs(aud.currentTime - local) > 0.4) {
            aud.currentTime = local;
          }
        } else {
          if (!aud.paused) aud.pause();
          if (!playing && inRange && Math.abs(aud.currentTime - local) > 0.1) {
            aud.currentTime = local;
          }
        }
      }

      for (const [trackId, aud] of audioRefs.current) {
        if (!byTrack[trackId]?.active && !aud.paused) aud.pause();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playbackStoreRef]);

  useEffect(() => {
    setTrackFxActions({ openEditor, bounceNow, audition, clearCache });
    return () => setTrackFxActions(null);
  }, [openEditor, bounceNow, audition, clearCache]);

  useEffect(() => () => {
    for (const aud of audioRefs.current.values()) {
      if (!aud.paused) aud.pause();
      disconnectMediaGainChain(aud);
    }
    audioRefs.current.clear();
  }, []);

  return { openEditor, bounceNow, audition, clearCache };
}
