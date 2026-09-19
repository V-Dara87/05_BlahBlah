import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioRecorder } from './useAudioRecorder';
import { loadAudioSettings } from '../services/audioSettings';
 
/**
 * useAudioRecording — per-track voice recording (arm/stop/finalize).
 *
 * Toggled from the per-track record button in TrackHeader. Clicking
 * record on a track arms that track (captures from the Settings-selected
 * input device); clicking again (or the Square/stop icon) stops, saves
 * the clip into Media > Recordings, and drops it onto that same track at
 * the time recording started. Also owns the input-device id (persisted
 * via Settings modal) and the effect that auto-stops an in-progress
 * recording when playback pauses (spacebar / manual pause).
 *
 * This wraps the lower-level useAudioRecorder (raw mic capture) with the
 * App-level policy of what a "recording" actually produces: a media asset
 * + a timeline clip. It needs `playbackStoreRef`/`getPlaybackTime` (from
 * usePlaybackController), `mediaAssets`/`handleAddMediaAsset` (from
 * useMediaAssets), and `handleAddMediaToTimeline` (from useProjectStore),
 * all injected as params since those hooks are wired up independently in
 * App.jsx.
 */
export function useAudioRecording({
  playbackStoreRef,
  getPlaybackTime,
  mediaAssets,
  handleAddMediaAsset,
  handleAddMediaToTimeline,
}) {
  const [recordingTrackId, setRecordingTrackId] = useState(null);
  const [recordingStartTime, setRecordingStartTime] = useState(0);
  const [audioInputDeviceId, setAudioInputDeviceId] = useState(() => loadAudioSettings().inputDeviceId);
  const recordingStartTimeRef = useRef(0);
  // Re-entrancy guard for handleToggleRecordTrack's stop branch. pause()
  // notifies playbackStore subscribers synchronously, and the stop-on-
  // pause effect below reads recordingTrackId from its own closure, which
  // still holds the pre-stop value until React re-renders — so pause()
  // called from inside the stop branch was re-entering this same handler
  // a second time before the first stop had finished, producing a second
  // (bogus/empty) clip per single recording. This ref is set the instant
  // a stop begins and checked immediately, independent of React state.
  const isStoppingRecordingRef = useRef(false);
  const { startRecording, stopRecording, level: recordingLevel } = useAudioRecorder({ inputDeviceId: audioInputDeviceId });
 
  const handleToggleRecordTrack = useCallback(async (trackId) => {
    if (recordingTrackId === trackId) {
      // Stop & finalize this track's recording.
      // Bail immediately if a stop is already in flight for this track —
      // see isStoppingRecordingRef declaration for why this re-entrancy
      // guard is needed (pause() below can synchronously re-trigger this
      // same branch via the stop-on-pause effect before React has
      // re-rendered recordingTrackId to null).
      if (isStoppingRecordingRef.current) return;
      isStoppingRecordingRef.current = true;
      const startTime = recordingStartTimeRef.current;
      setRecordingTrackId(null);
      setRecordingStartTime(0);
      playbackStoreRef.current?.setIsRecording(false);
      playbackStoreRef.current?.pause();
      let result;
      try {
        result = await stopRecording();
      } finally {
        isStoppingRecordingRef.current = false;
      }
      if (!result || !result.blob || result.durationSec < 0.15) return;
 
      const { blob, durationSec, mimeType } = result;
      // The recorder always yields WAV now; keep the mime-derived ext so a
      // future format change here can't silently mislabel files.
      const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('webm') ? 'webm' : 'wav';
      // Next free take number — NOT "count + 1". Counting reused a live name
      // after any earlier take was deleted (e.g. keep #2,#3 -> next was #3),
      // and the on-disk write then silently overwrote that existing file.
      // Numbers are compared ignoring the extension so an old Recording_003.webm
      // also blocks a new Recording_003.wav.
      const usedTakes = new Set(
        mediaAssets
          .filter((m) => m.folder === 'Recordings')
          .map((m) => /^Recording_(\d+)\./i.exec(m.name || '')?.[1])
          .filter(Boolean)
          .map(Number)
      );
      let takeNumber = 1;
      while (usedTakes.has(takeNumber)) takeNumber += 1;
      const fileName = `Recording_${String(takeNumber).padStart(3, '0')}.${ext}`;
      const url = URL.createObjectURL(blob);
      const file = new File([blob], fileName, { type: mimeType });
 
      const asset = {
        id: `asset-recording-${Date.now()}`,
        name: fileName,
        type: 'audio',
        url,
        duration: durationSec,
        size: blob.size,
        folder: 'Recordings',
        createdAt: Date.now(),
      };
 
      // Use the FINAL resolved URL (disk URL once saved, see
      // handleAddMediaAsset's return value) for the clip we place on the
      // timeline — not asset.url, which stays a blob: URL forever since
      // handleAddMediaAsset never mutates the local `asset` object it
      // was passed, only its own internal mediaAssets state. Using
      // asset.url here was the actual cause of recorded clips losing
      // their audio after a reload.
      const finalUrl = await handleAddMediaAsset(asset, file);
      handleAddMediaToTimeline({ ...asset, url: finalUrl }, trackId, startTime);
      return;
    }
 
    if (recordingTrackId) return; // another track is already recording
 
    // Arm this track and start capturing at the current playhead position
    const startTime = getPlaybackTime();
    recordingStartTimeRef.current = startTime;
    setRecordingStartTime(startTime);
    setRecordingTrackId(trackId);
    await startRecording();
    playbackStoreRef.current?.setIsRecording(true);
    playbackStoreRef.current?.play();
  }, [recordingTrackId, getPlaybackTime, mediaAssets, startRecording, stopRecording, handleAddMediaAsset, handleAddMediaToTimeline, playbackStoreRef]);
 
  // Synchronize playback stopping (spacebar / pause) with active recording.
  //
  // BUGFIX: play() is async — right after we call it in
  // handleToggleRecordTrack, the store can briefly still report
  // isPlaying() === false before playback actually engages. Without a
  // guard, that transient false was being treated as "the user stopped
  // playback", which auto-finalized the recording into a clip almost
  // immediately (near-empty blob), while the mic stream stayed open and a
  // *second* MediaRecorder session started on the next click — hence one
  // real recording turning into two clips (one silent/truncated). Fix:
  // only arm the stop-on-pause listener once we've observed isPlaying()
  // actually become true at least once for this recording session, so a
  // startup blip can't be mistaken for a real stop.
  const hasSeenPlaybackStartRef = useRef(false);
  useEffect(() => {
    if (!recordingTrackId) {
      hasSeenPlaybackStartRef.current = false;
      return;
    }
    const store = playbackStoreRef.current;
    if (!store) return;
    const unsub = store.subscribe(() => {
      const isPlaying = store.getIsPlaying();
      if (isPlaying) {
        hasSeenPlaybackStartRef.current = true;
        return;
      }
      if (hasSeenPlaybackStartRef.current && recordingTrackId) {
        handleToggleRecordTrack(recordingTrackId);
      }
    });
    return unsub;
  }, [recordingTrackId, handleToggleRecordTrack, playbackStoreRef]);
 
  const handleAudioSettingsChanged = useCallback((settings) => {
    setAudioInputDeviceId(settings.inputDeviceId);
  }, []);
 
  return {
    recordingTrackId,
    recordingStartTime,
    recordingLevel,
    handleToggleRecordTrack,
    handleAudioSettingsChanged,
  };
}