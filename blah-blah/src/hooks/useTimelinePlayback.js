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
  // GUARD -- tracks whether the *next* setCurrentTime call is an
  // intentional jump (explicit seek(), or the tick loop's own loop-to-0 /
  // clamp-to-end). Any other backward jump is unexpected and gets caught
  // by guardedSetCurrentTime below instead of silently applied.
  const intentionalJumpRef = useRef(false);
 
  // GUARD -- wraps setCurrentTime so any backward jump that didn't come
  // from an explicit seek() or the tick loop's own intentional loop/clamp
  // gets caught here instead of silently applied. Logs a full stack trace
  // (so we can see exactly what called it) and, since we can't yet tell
  // whether such a jump would ever be legitimate, blocks it rather than
  // letting the playhead snap backward while things are actively
  // rendering. This is meant to catch and stop the "rolls back hard while
  // there's content on screen" report at its source, whatever that source
  // turns out to be, rather than requiring a specific diagnosis first.
  const guardedSetCurrentTime = useCallback((next) => {
    const prev = currentTimeRef.current;
    const isIntentional = intentionalJumpRef.current;
    intentionalJumpRef.current = false;
 
    if (!isIntentional && next < prev - 0.05) {
      console.warn(
        '[GUARD] Blocked unexpected backward currentTime jump:',
        prev.toFixed(3), '->', next.toFixed(3),
        '\nStack trace:', new Error().stack
      );
      return;
    }
 
    currentTimeRef.current = next;
    setCurrentTime(next);
  }, []);
 
  // Sync ref values via useEffect
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
 
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);
 
  useEffect(() => {
    // DEBUG -- temporary. Confirms exactly when totalDurationRef updates
    // and to what value, so we can line this timestamp up against the
    // LOOP/STOP logs in the tick loop below.
    if (totalDurationRef.current !== totalDuration) {
      console.log('[DEBUG] totalDuration prop changed:', totalDurationRef.current, '->', totalDuration);
    }
    totalDurationRef.current = totalDuration;
  }, [totalDuration]);
 
  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);
 
  useEffect(() => {
    isLoopingRef.current = isLooping;
  }, [isLooping]);
 
  const seek = useCallback((time) => {
    // BUG FIX -- `totalDurationRef.current || 60` meant seeking against a
    // genuinely empty (0-duration) timeline silently clamped to a fake 60s
    // ceiling instead of 0, letting the playhead be dragged somewhere
    // meaningless on a project with nothing on it. Only fall back to 60
    // when totalDuration is missing/undefined, not when it's legitimately 0.
    const effectiveMax = totalDurationRef.current === undefined || totalDurationRef.current === null
      ? 60
      : totalDurationRef.current;
    const clamped = Math.max(0, Math.min(effectiveMax, time));
    intentionalJumpRef.current = true; // explicit seek -- always allowed, forward or back
    guardedSetCurrentTime(clamped);
  }, [guardedSetCurrentTime]);
 
  const play = useCallback(() => {
    // BUG FIX -- totalDuration is 0 for a genuinely empty timeline (see
    // App.jsx's calculatedDuration). Previously this had no guard for that
    // case, and the tick loop below used `Math.max(1, totalDurationRef.current)`
    // as its effective max, which fabricated a fake 1-second timeline out of
    // nothing -- so Play would happily start (and, with Loop on, loop
    // forever) against an empty project. Refuse to start playback when
    // there's nothing to play.
    if (totalDurationRef.current <= 0) return;
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
    // BUG FIX -- defense in depth alongside play()'s guard above: if
    // isPlaying is ever true while totalDuration is 0 (e.g. all clips
    // deleted mid-playback), don't run the tick loop at all rather than
    // ticking against a fabricated 1-second floor.
    if (!isPlaying || totalDurationRef.current <= 0) {
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
 
      // DEBUG -- temporary logging to track down the "rolls back / freezes
      // while playing" report. A deltaSec this large means the browser
      // went a long time between rAF callbacks -- i.e. a real freeze/dropped
      // frames, not a logic bug -- so this fires independently of the
      // rollback logging below and helps tell the two symptoms apart.
      // 0.25s ~= missed ~15 frames at 60fps; tune/remove once diagnosed.
      if (deltaSec > 0.25) {
        console.log(
          '[DEBUG] long frame gap detected:', (deltaSec * 1000).toFixed(1) + 'ms',
          '| currentTime was:', currentTimeRef.current.toFixed(2)
        );
      }
 
      // If the timeline became empty mid-playback, stop rather than
      // ticking/looping against a fabricated floor.
      if (totalDurationRef.current <= 0) {
        console.log('[DEBUG] stopping playback: totalDuration is 0 mid-playback');
        setIsPlaying(false);
        return;
      }
 
      let nextTime = currentTimeRef.current + deltaSec;
      const maxDur = totalDurationRef.current;
 
      if (nextTime >= maxDur) {
        if (isLoopingRef.current) {
          // DEBUG -- this is the "rolls back" branch. Logs the exact
          // currentTime/maxDur right before snapping to 0, so we can see
          // whether maxDur matches what you'd expect from the actual clips
          // on the timeline, or is smaller/different than expected.
          console.log(
            '[DEBUG] LOOP: currentTime', currentTimeRef.current.toFixed(2),
            '>= maxDur', maxDur.toFixed(2), '-> snapping to 0'
          );
          nextTime = 0;
          intentionalJumpRef.current = true; // legitimate loop-to-0
          guardedSetCurrentTime(0);
          animFrameIdRef.current = requestAnimationFrame(tick);
        } else {
          console.log(
            '[DEBUG] STOP: currentTime', currentTimeRef.current.toFixed(2),
            '>= maxDur', maxDur.toFixed(2), '-> stopping at end'
          );
          nextTime = maxDur;
          intentionalJumpRef.current = true; // legitimate clamp-to-end (forward, but mark anyway for consistency)
          guardedSetCurrentTime(maxDur);
          setIsPlaying(false);
        }
      } else {
        guardedSetCurrentTime(nextTime);
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
 