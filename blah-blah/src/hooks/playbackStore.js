/**
 * External playback store — updates currentTime on rAF without React setState,
 * so App and dock panels don't re-render every frame. Components subscribe
 * via useSyncExternalStore; the playhead uses registerFrameCallback for
 * imperative DOM updates in the same rAF tick.
 */
export function createPlaybackStore(initialTotalDuration = 60) {
  let isPlaying = false;
  let currentTime = 0;
  let playbackRate = 1;
  let isLooping = false;
  let isRecording = false;
  let totalDuration = initialTotalDuration;

  let lastFrameTime = null;
  let animFrameId = null;

  const listeners = new Set();
  const frameCallbacks = new Set();

  let intentionalJump = false;

  const notify = () => {
    listeners.forEach((l) => l());
  };

  const setCurrentTimeInternal = (next) => {
    const prev = currentTime;
    const isIntentional = intentionalJump;
    intentionalJump = false;

    if (!isIntentional && next < prev - 0.05) {
      console.warn(
        '[GUARD] Blocked unexpected backward currentTime jump:',
        prev.toFixed(3), '->', next.toFixed(3),
        '\nStack trace:', new Error().stack
      );
      return;
    }

    if (currentTime === next) return;
    currentTime = next;
    notify();
  };

  const runFrameCallbacks = (time) => {
    frameCallbacks.forEach((fn) => fn(time));
  };

  const cancelTick = () => {
    lastFrameTime = null;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  };

  const tick = (now) => {
    if (!lastFrameTime) {
      lastFrameTime = now;
    }
    const deltaSec = ((now - lastFrameTime) / 1000) * playbackRate;
    lastFrameTime = now;

    if (totalDuration <= 0) {
      isPlaying = false;
      cancelTick();
      notify();
      return;
    }

    let nextTime = currentTime + deltaSec;
    const maxDur = totalDuration;

    if (nextTime >= maxDur) {
      if (isRecording) {
        totalDuration = Math.max(totalDuration + 30, nextTime + 10);
        currentTime = nextTime;
        runFrameCallbacks(nextTime);
        notify();
        animFrameId = requestAnimationFrame(tick);
        return;
      }
      if (isLooping) {
        nextTime = 0;
        intentionalJump = true;
        currentTime = 0;
        runFrameCallbacks(0);
        notify();
        animFrameId = requestAnimationFrame(tick);
      } else {
        nextTime = maxDur;
        intentionalJump = true;
        currentTime = maxDur;
        runFrameCallbacks(maxDur);
        isPlaying = false;
        notify();
        cancelTick();
      }
    } else {
      currentTime = nextTime;
      runFrameCallbacks(nextTime);
      notify();
      animFrameId = requestAnimationFrame(tick);
    }
  };

  const startTick = () => {
    cancelTick();
    animFrameId = requestAnimationFrame(tick);
  };

  const effectiveMax = () =>
    totalDuration === undefined || totalDuration === null ? 60 : totalDuration;

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    registerFrameCallback(fn) {
      frameCallbacks.add(fn);
      return () => frameCallbacks.delete(fn);
    },

    getSnapshot() {
      return currentTime;
    },

    getIsPlayingSnapshot() {
      return isPlaying;
    },

    getIsLoopingSnapshot() {
      return isLooping;
    },

    getCurrentTime() {
      return currentTime;
    },

    getIsPlaying() {
      return isPlaying;
    },

    setTotalDuration(dur) {
      totalDuration = dur;
    },

    seek(time) {
      const clamped = Math.max(0, Math.min(effectiveMax(), time));
      intentionalJump = true;
      setCurrentTimeInternal(clamped);
      runFrameCallbacks(clamped);
    },

    setIsRecording(rec) {
      isRecording = !!rec;
    },

    getIsRecording() {
      return isRecording;
    },

    play() {
      if (totalDuration <= 0) return;
      if (!isRecording && currentTime >= totalDuration && totalDuration > 0) {
        intentionalJump = true;
        setCurrentTimeInternal(0);
        runFrameCallbacks(0);
      }
      if (!isPlaying) {
        isPlaying = true;
        notify();
        startTick();
      }
    },

    pause() {
      if (isPlaying) {
        isPlaying = false;
        notify();
      }
      cancelTick();
    },

    togglePlay() {
      if (isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    },

    setPlaybackRate(rate) {
      playbackRate = rate;
    },

    setIsLooping(loop) {
      isLooping = loop;
      notify();
    },

    toggleLoop() {
      isLooping = !isLooping;
      notify();
    },
  };
}
