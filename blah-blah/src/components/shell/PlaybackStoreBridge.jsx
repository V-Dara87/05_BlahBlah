import { useEffect } from 'react';
import { usePlaybackStore } from '../../hooks/PlaybackContext';

/** Keeps a ref on the playback store reachable from App-level handlers. */
export function PlaybackStoreBridge({ storeRef }) {
  const store = usePlaybackStore();
  useEffect(() => {
    storeRef.current = store;
    return () => {
      storeRef.current = null;
    };
  }, [store, storeRef]);
  return null;
}
