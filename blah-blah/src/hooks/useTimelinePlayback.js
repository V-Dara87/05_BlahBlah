import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Custom hook to manage timeline playback clock, frame ticking,
 * loop handling, and playhead seeking.
 */
export function useTimelinePlayback(totalDuration = 60) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isLooping, setIsLooping] = useState(false);

  const lastFrameTimeRef = useRef(null);
  const animFrameIdRef = useRef(null);
  const isPlayingRef = useRef(isPlaying);
  const currentTimeRef = useRef(currentTime);
  const totalDurationRef = useRef(totalDuration);
  const playbackRateRef = useRef(playbackRate);
  const isLoopingRef = useRef(isLooping);

  // Sync ref values via useEffect
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    totalDurationRef.current = totalDuration;
  }, [totalDuration]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    isLoopingRef.current = isLooping;
  }, [isLooping]);

  const seek = useCallback((time) => {
    const clamped = Math.max(0, Math.min(totalDurationRef.current || 60, time));
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);
  }, []);

  const play = useCallback(() => {
    if (currentTimeRef.current >= totalDurationRef.current && totalDurationRef.current > 0) {
      seek(0);
    }
    setIsPlaying(true);
  }, [seek]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) {
      pause();
    } else {
      play();
    }
  }, [pause, play]);

  // Main animation tick loop
  useEffect(() => {
    if (!isPlaying) {
      lastFrameTimeRef.current = null;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      return;
    }

    const tick = (now) => {
      if (!lastFrameTimeRef.current) {
        lastFrameTimeRef.current = now;
      }
      const deltaSec = ((now - lastFrameTimeRef.current) / 1000) * playbackRateRef.current;
      lastFrameTimeRef.current = now;

      let nextTime = currentTimeRef.current + deltaSec;
      const maxDur = Math.max(1, totalDurationRef.current);

      if (nextTime >= maxDur) {
        if (isLoopingRef.current) {
          nextTime = 0;
          currentTimeRef.current = 0;
          setCurrentTime(0);
          animFrameIdRef.current = requestAnimationFrame(tick);
        } else {
          nextTime = maxDur;
          currentTimeRef.current = maxDur;
          setCurrentTime(maxDur);
          setIsPlaying(false);
        }
      } else {
        currentTimeRef.current = nextTime;
        setCurrentTime(nextTime);
        animFrameIdRef.current = requestAnimationFrame(tick);
      }
    };

    animFrameIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [isPlaying]);

  return {
    isPlaying,
    currentTime,
    playbackRate,
    isLooping,
    play,
    pause,
    togglePlay,
    seek,
    setPlaybackRate,
    setIsLooping,
  };
}
