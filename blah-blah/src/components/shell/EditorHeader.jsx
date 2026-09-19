import { UnityHeader } from './UnityHeader';
import { useCurrentTime, useIsPlaying, useIsLooping, usePlaybackStore } from '../../hooks/PlaybackContext';

export function EditorHeader(props) {
  const currentTime = useCurrentTime();
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
