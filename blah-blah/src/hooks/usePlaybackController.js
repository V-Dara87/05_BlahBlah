import { useRef, useCallback } from 'react';

/**
 * usePlaybackController — App-level handle on timeline playback.
 *
 * NOTE ON ARCHITECTURE (why this hook is so thin): App.jsx does NOT own
 * playback state. currentTime / isPlaying / isLooping are driven entirely
 * by `PlaybackProvider` -> `createPlaybackStore` (see PlaybackContext.jsx /
 * playbackStore.js), an external store that ticks on rAF WITHOUT React
 * setState, so App and the dock panels never re-render every frame; panels
 * subscribe via useCurrentTime/useIsPlaying (useSyncExternalStore), and the
 * playhead/Timeline write imperatively via registerFrameCallback. That
 * split (React-free clock) predates this refactor and is deliberately kept.
 *
 * This hook exists only to give App-level *handlers* a synchronous way to
 * read the playhead (split-at-playhead, recording start time, drop/insert
 * positioning) without threading the store object through every call site:
 * it owns the `playbackStoreRef` that `<PlaybackStoreBridge>` fills once
 * the PlaybackProvider mounts inside the editor tree, and exposes
 * getPlaybackTime() reading through it (returns 0 on the Hub screen, where
 * no store is mounted — same as the old inline code).
 *
 * The legacy `useTimelinePlayback` hook (hooks/useTimelinePlayback.js) is
 * NOT wired in here on purpose: it was superseded by the external-store
 * PlaybackProvider design, and adopting it would change playback behavior —
 * this refactor is file-splitting only.
 */
export function usePlaybackController() {
  const playbackStoreRef = useRef(null);

  const getPlaybackTime = useCallback(() => playbackStoreRef.current?.getCurrentTime() ?? 0, []);

  return {
    playbackStoreRef,
    getPlaybackTime,
  };
}
