import { useState, useRef, useCallback, useEffect } from 'react';
import { encodeWav, mergeFloat32Chunks, mixToMono } from '../utils/wavEncoder';
 
/**
 * Shared microphone + level-meter + MediaRecorder logic.
 *
 * Used in two places:
 * 1. SettingsModal — just wants the live level meter for the chosen
 *    input device, never actually records to a file.
 * 2. TrackHeader (per-track record button) — wants the level meter
 *    AND to capture a WAV blob when the user hits record/stop.
 *
 * Recording is captured as raw PCM through Web Audio and encoded to a 16-bit
 * WAV (see utils/wavEncoder.js). MediaRecorder is deliberately NOT used:
 * Chromium/WebView2 can only produce WebM/Opus, which is lossy, and which
 * projectFileSystem.js doesn't classify as audio when a project is reloaded.
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
  const sourceRef = useRef(null);
  const rafRef = useRef(null);
  const captureRef = useRef(null); // { node, sink, chunks, sampleRate, startedAt }
 
  const stopMeter = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);
 
  const teardownCapture = useCallback(() => {
    const cap = captureRef.current;
    if (!cap) return;
    try { cap.node.onaudioprocess = null; } catch { /* ignore */ }
    try { cap.node.disconnect(); } catch { /* ignore */ }
    try { cap.sink.disconnect(); } catch { /* ignore */ }
    captureRef.current = null;
  }, []);
 
  const closeStream = useCallback(() => {
    teardownCapture();
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
    sourceRef.current = null;
    setIsMonitoring(false);
    setLevel(0);
  }, [stopMeter, teardownCapture]);
 
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
      sourceRef.current = source;
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
 
      const audioCtx = audioCtxRef.current;
      const source = sourceRef.current;
      if (!audioCtx || !source) throw new Error('Audio engine not ready');
      // A context created before any user gesture can be suspended, which
      // would deliver zero samples and yield a silent/empty take.
      if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {});
 
      teardownCapture();
      const chunks = [];
      // ScriptProcessorNode is deprecated but still supported by every
      // Chromium/WebView2 build, and — unlike an AudioWorklet — needs no
      // separate module file / CSP allowance. 4096 frames ≈ 85 ms at 48 kHz.
      const node = audioCtx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => {
        const input = e.inputBuffer;
        const channels = [];
        for (let ch = 0; ch < input.numberOfChannels; ch++) {
          channels.push(input.getChannelData(ch));
        }
        // getChannelData is reused by the engine — copy, don't keep a view.
        chunks.push(new Float32Array(mixToMono(channels)));
      };
      // A ScriptProcessor only runs while connected to the destination. Route
      // it through a muted gain so the mic is never played back (feedback).
      const sink = audioCtx.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(audioCtx.destination);
 
      captureRef.current = {
        node,
        sink,
        chunks,
        sampleRate: audioCtx.sampleRate,
        startedAt: Date.now(),
      };
      setIsRecording(true);
    } catch (err) {
      setError(err.message || 'Could not start recording');
      setIsRecording(false);
    }
  }, [startMonitoring, teardownCapture]);
 
  // Stop recording, resolve with the captured WAV blob + duration.
  const stopRecording = useCallback(async () => {
    const cap = captureRef.current;
    if (!cap) return null;
    const { chunks, sampleRate, startedAt } = cap;
    teardownCapture();
    setIsRecording(false);
 
    const samples = mergeFloat32Chunks(chunks);
    if (samples.length === 0) return null;
    const blob = encodeWav(samples, sampleRate);
    // Duration from the real sample count, not wall-clock: it can't drift
    // and always matches what the file actually contains.
    const durationSec = samples.length / sampleRate;
    void startedAt;
    return { blob, durationSec, mimeType: 'audio/wav' };
  }, [teardownCapture]);
 
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
 