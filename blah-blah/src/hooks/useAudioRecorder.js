import { useState, useRef, useCallback, useEffect } from 'react';
 
/**
 * Shared microphone + level-meter + MediaRecorder logic.
 *
 * Used in two places:
 * 1. SettingsModal — just wants the live level meter for the chosen
 *    input device, never actually records to a file.
 * 2. TrackHeader (per-track record button) — wants the level meter
 *    AND to capture a WAV/WebM blob when the user hits record/stop.
 *
 * Level metering runs via Web Audio's AnalyserNode (time-domain RMS),
 * sampled with requestAnimationFrame — cheap enough to run continuously
 * while a device is "open" (monitoring) even when not recording.
 */
export function useAudioRecorder({ inputDeviceId } = {}) {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [level, setLevel] = useState(0); // 0..1 RMS
  const [error, setError] = useState(null);
 
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recordStartedAtRef = useRef(null);
 
  const stopMeter = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);
 
  const closeStream = useCallback(() => {
    stopMeter();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setIsMonitoring(false);
    setLevel(0);
  }, [stopMeter]);
 
  const runMeterLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      setLevel(Math.min(1, rms * 3.2)); // scaled up so normal speech isn't tiny
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);
 
  // Open the mic stream + start the level meter, without recording.
  const startMonitoring = useCallback(async () => {
    setError(null);
    try {
      closeStream();
      const constraints = {
        audio: inputDeviceId && inputDeviceId !== 'default'
          ? { deviceId: { exact: inputDeviceId } }
          : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
 
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;
 
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;
 
      setIsMonitoring(true);
      runMeterLoop();
    } catch (err) {
      setError(err.message || 'Could not access microphone');
      closeStream();
    }
  }, [inputDeviceId, closeStream, runMeterLoop]);
 
  const stopMonitoring = useCallback(() => {
    if (isRecording) return; // don't tear down mid-recording
    closeStream();
  }, [isRecording, closeStream]);
 
  // Begin recording (also starts monitoring/level meter if not already).
  const startRecording = useCallback(async () => {
    setError(null);
    try {
      if (!streamRef.current) {
        await startMonitoring();
      }
      const stream = streamRef.current;
      if (!stream) throw new Error('Microphone not available');
 
      const mimeType = MediaRecorder.isTypeSupported('audio/webm; codecs=opus')
        ? 'audio/webm; codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recordStartedAtRef.current = Date.now();
 
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
 
      const stoppedPromise = new Promise((resolve) => {
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const durationSec = (Date.now() - recordStartedAtRef.current) / 1000;
          resolve({ blob, durationSec, mimeType });
        };
      });
 
      mediaRecorderRef.current = { recorder, stoppedPromise };
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      setError(err.message || 'Could not start recording');
      setIsRecording(false);
    }
  }, [startMonitoring]);
 
  // Stop recording, resolve with the captured blob + duration.
  const stopRecording = useCallback(async () => {
    const active = mediaRecorderRef.current;
    if (!active) return null;
    active.recorder.stop();
    const result = await active.stoppedPromise;
    mediaRecorderRef.current = null;
    setIsRecording(false);
    return result;
  }, []);
 
  useEffect(() => () => closeStream(), [closeStream]);
 
  return {
    isMonitoring,
    isRecording,
    level,
    error,
    startMonitoring,
    stopMonitoring,
    startRecording,
    stopRecording,
  };
}
 