import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPlaybackStore } from './playbackStore';

const PlaybackContext = createContext(null);

export function PlaybackProvider({ totalDuration, children }) {
  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = createPlaybackStore(totalDuration);
  }

  useEffect(() => {
    storeRef.current.setTotalDuration(totalDuration);
  }, [totalDuration]);

  return (
    <PlaybackContext.Provider value={storeRef.current}>
      {children}
    </PlaybackContext.Provider>
  );
}

export function usePlaybackStore() {
  const store = useContext(PlaybackContext);
  if (!store) {
    throw new Error('usePlaybackStore must be used inside <PlaybackProvider>');
  }
  return store;
}

export function useCurrentTime() {
  const store = usePlaybackStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// While the playhead is being dragged, display-only panels never refresh faster
// than this, even if they asked for a higher rate while playing (the Dopesheet
// asks for 30 Hz). Keeps a scrub from re-rendering the Inspector / Dopesheet /
// header on every pointermove.
const SCRUB_MAX_HZ = 15;

/**
 * Playback time for panels that only DISPLAY it (header timecode, Inspector
 * animated values, Dopesheet playhead). While playing OR scrubbing, re-renders
 * are limited to `maxHz` per second instead of once per animation frame /
 * pointermove; when neither (single click-seek, keyboard step, the final tick
 * after a stop) the time applies immediately. When a scrub ends the latest
 * time is flushed at once so nothing is left showing a stale value.
 *
 * The live preview must keep using useCurrentTime() — it needs every frame.
 */
export function useThrottledCurrentTime(maxHz = 10) {
  const store = usePlaybackStore();
  const [time, setTime] = useState(() => store.getCurrentTime());

  useEffect(() => {
    const playGap = 1000 / Math.max(1, maxHz);
    const scrubGap = 1000 / Math.max(1, Math.min(maxHz, SCRUB_MAX_HZ));
    let last = 0;
    let timer = null;

    const sync = () => {
      timer = null;
      last = performance.now();
      setTime(store.getCurrentTime());
    };

    const flush = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      sync();
    };

    const onChange = () => {
      const isPlaying = store.getIsPlaying();
      const isScrubbing = store.getIsScrubbing();
      if (!isPlaying && !isScrubbing) {
        // Idle: click-seeks, keyboard steps and the last tick after a stop
        // apply at once.
        flush();
        return;
      }
      const minGap = isScrubbing ? scrubGap : playGap;
      const wait = minGap - (performance.now() - last);
      if (wait <= 0) {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        sync();
      } else if (timer === null) {
        timer = setTimeout(sync, wait);
      }
    };

    // Catch anything that changed between render and subscribe.
    sync();
    const unsubscribe = store.subscribe(onChange);
    // Scrub released: show the exact final time right away.
    const unsubscribeScrubEnd = store.subscribeScrubEnd(flush);
    return () => {
      unsubscribe();
      unsubscribeScrubEnd();
      if (timer !== null) clearTimeout(timer);
    };
  }, [store, maxHz]);

  return time;
}

export function useIsPlaying() {
  const store = usePlaybackStore();
  return useSyncExternalStore(store.subscribe, store.getIsPlayingSnapshot, store.getIsPlayingSnapshot);
}

export function useIsLooping() {
  const store = usePlaybackStore();
  return useSyncExternalStore(store.subscribe, store.getIsLoopingSnapshot, store.getIsLoopingSnapshot);
}