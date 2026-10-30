import { UnityHeader } from './UnityHeader';
import { useThrottledCurrentTime, useIsPlaying, useIsLooping, usePlaybackStore } from '../../hooks/PlaybackContext';

export function EditorHeader(props) {
  // Timecode text only: no need to re-render the whole header 60x/s.
  const currentTime = useThrottledCurrentTime(15);
  const isPlaying = useIsPlaying();
  const isLooping = useIsLooping();
  const store = usePlaybackStore();

  return (
    <UnityHeader
      {...props}
      currentTime={currentTime}
      isPlaying={isPlaying}
      isLooping={isLooping}
      onTogglePlay={() => store.togglePlay()}
      onSeek={(t) => store.seek(t)}
      onToggleLoop={() => store.toggleLoop()}
    />
  );
}