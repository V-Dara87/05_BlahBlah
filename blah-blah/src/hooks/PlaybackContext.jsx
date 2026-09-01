import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
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

export function useIsPlaying() {
  const store = usePlaybackStore();
  return useSyncExternalStore(store.subscribe, store.getIsPlayingSnapshot, store.getIsPlayingSnapshot);
}

export function useIsLooping() {
  const store = usePlaybackStore();
  return useSyncExternalStore(store.subscribe, store.getIsLoopingSnapshot, store.getIsLoopingSnapshot);
}
