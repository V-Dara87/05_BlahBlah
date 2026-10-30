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

/**
 * Playback time for panels that only DISPLAY it (header timecode, Inspector
 * animated values, Dopesheet playhead). While playing, re-renders are limited
 * to `maxHz` per second instead of once per animation frame; when paused,
 * seeking / scrubbing / the final time after a stop update immediately.
 *
 * The live preview must keep using useCurrentTime() — it needs every frame.
 */
export function useThrottledCurrentTime(maxHz = 10) {
  const store = usePlaybackStore();
  const [time, setTime] = useState(() => store.getCurrentTime());

  useEffect(() => {
    const minGap = 1000 / Math.max(1, maxHz);
    let last = 0;
    let timer = null;

    const sync = () => {
      timer = null;
      last = performance.now();
      setTime(store.getCurrentTime());
    };

    const onChange = () => {
      if (!store.getIsPlaying()) {
        // Paused: seeks, scrubs and the last tick after a stop apply at once.
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        sync();
        return;
      }
      const wait = minGap - (performance.now() - last);
      if (wait <= 0) {
        sync();
      } else if (timer === null) {
        timer = setTimeout(sync, wait);
      }
    };

    // Catch anything that changed between render and subscribe.
    sync();
    const unsubscribe = store.subscribe(onChange);
    return () => {
      unsubscribe();
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