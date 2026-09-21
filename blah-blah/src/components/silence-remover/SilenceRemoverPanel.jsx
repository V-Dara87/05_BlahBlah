import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import {
  Scissors,
  Volume2,
  Sliders,
  Clock,
  Layers,
  Film,
  Music,
  ArrowRight,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Cpu,
} from 'lucide-react';
import { decodeAudio } from '../../utils/audioWaveform';
import {
  detectSilenceWithWebAudio,
  detectSilenceWithFfmpeg,
  computeAudibleAndSilentSegments,
  formatTime,
  isTauri,
  isFfmpegAvailable,
} from '../../services/silenceDetector';
import './silence-remover-panel.css';

// Media longer than this is never decoded into an AudioBuffer in the desktop
// build (see utils/audioWaveform.js) — silence detection uses the FFmpeg
// `silencedetect` path instead. The in-memory Web Audio analyzer stays for
// short clips and the browser build, where it is fast and needs no sidecar.
const LONG_CLIP_DECODE_LIMIT_SEC = 10 * 60;
 
/**
 * SilenceRemoverPanel — Dockable Panel for Audio Silence Detection & Cutting
 *
 * Provides real-time silence detection with adjustable threshold (dB),
 * minimum pause duration, and padding/offset buffers. Features live audio
 * auditioning with dynamic silence skipping, individual pause toggle,
 * and live on-timeline cut overlay broadcasting.
 */
export const SilenceRemoverPanel = memo(function SilenceRemoverPanel({
  activeTargetType = 'clip', // 'clip' | 'track'
  activeTargetId = null,
  allEntities = [],
  allTracks = [],
  mediaAssets = [],
  onApplyCutSilence,
  onUpdatePreviewCuts, // (previewData: { targetType, targetId, cuts: [] }) => void
}) {
  // Master on/off switch for the whole panel. Starts OFF: previously
  // this panel ran audio decode + silence detection + live timeline-cut
  // overlays unconditionally the moment it had an activeClip, so simply
  // opening the tab silently painted cut regions onto the timeline even
  // if you just wanted to glance at it. Every effect below now checks
  // this before doing any work, and the timeline overlay is explicitly
  // cleared when it flips off.
  const [isEnabled, setIsEnabled] = useState(false);
 
  const [targetType, setTargetType] = useState(activeTargetType);
  const [selectedClipId, setSelectedClipId] = useState(activeTargetId);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
 
  // Settings
  const [thresholdDb, setThresholdDb] = useState(-45);
  const [minSilenceDuration, setMinSilenceDuration] = useState(0.4);
  const [padding, setPadding] = useState(0.12); // 120ms offset / padding
  const [minSpeechDuration, setMinSpeechDuration] = useState(0.15);
  const [rippleMode, setRippleMode] = useState(true);
  const [useFfmpegEngine, setUseFfmpegEngine] = useState(false);
  const [disabledCutIds, setDisabledCutIds] = useState(new Set());
  // Manual edge overrides for auto-detected cuts, keyed by cut.id (see
  // computeAudibleAndSilentSegments — cut ids are stable across a given
  // detection run since they're derived from index + rounded start time).
  // computed.cutSegments below is fully re-derived from raw detection on
  // every threshold/padding change, so without this map any drag done on
  // the timeline's cut-edge handles would be silently discarded the next
  // time anything re-triggers detection. This map is applied ON TOP of
  // computed.cutSegments (see `displayCutSegments` below) and is the
  // source of truth once the user has manually adjusted a given cut.
  const [manualCutOverrides, setManualCutOverrides] = useState({}); // { [cutId]: { start, end } }
 
  // Audio / Detection state
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [rawSilenceIntervals, setRawSilenceIntervals] = useState([]);
  const [ffmpegSupported, setFfmpegSupported] = useState(false);
 
  // Live Audition Player
  const [isAuditioning, setIsAuditioning] = useState(false);
  const [auditionCurrentTime, setAuditionCurrentTime] = useState(0);
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const auditionRafRef = useRef(null);
  const auditionStartWallTimeRef = useRef(0);
  const auditionStartAudioTimeRef = useRef(0);
 
  // Check FFmpeg availability on mount
  useEffect(() => {
    isFfmpegAvailable().then((avail) => setFfmpegSupported(avail));
  }, []);
 
  // Update target when props change
  useEffect(() => {
    if (activeTargetId) {
      if (activeTargetType === 'track') {
        setTargetType('track');
        setSelectedTrackId(activeTargetId);
      } else {
        setTargetType('clip');
        setSelectedClipId(activeTargetId);
      }
      setDisabledCutIds(new Set());
    }
  }, [activeTargetId, activeTargetType]);
 
  // Active clip resolution
  const activeClip = useMemo(() => {
    if (targetType === 'clip') {
      if (selectedClipId) {
        const found = allEntities.find((e) => e.id === selectedClipId);
        if (found) return found;
      }
      // Default to first audio/video clip
      return (
        allEntities.find(
          (e) =>
            e.type === 'audio' ||
            e.type === 'video' ||
            e.components?.some((c) => c.type === 'AudioSource' || c.type === 'VideoRenderer')
        ) || null
      );
    }
    return null;
  }, [targetType, selectedClipId, allEntities]);
 
  // Audio/video clips for dropdown
  const audioVideoClips = useMemo(() => {
    return allEntities.filter(
      (e) =>
        e.type === 'audio' ||
        e.type === 'video' ||
        e.components?.some((c) => c.type === 'AudioSource' || c.type === 'VideoRenderer')
    );
  }, [allEntities]);
 
  // Audio source resolution
  const audioSourceInfo = useMemo(() => {
    if (!activeClip) return null;
    let url = activeClip.src;
    let filePath = null;
    const comp = activeClip.components?.find((c) => c.type === 'AudioSource' || c.type === 'VideoRenderer');
    if (comp?.src) url = comp.src;
 
    // Resolve matching asset for disk file path + source duration (Tauri
    // mode). Exact URL first so the duration used to decide whether this
    // source is too long to decode comes from the right asset; the looser
    // name match only covers blob -> disk URL reconciliation.
    const asset =
      mediaAssets.find((a) => a.url === url)
      || mediaAssets.find((a) => a.name === activeClip.name || url?.includes(a.name));
    if (asset?.path) filePath = asset.path;
 
    const mediaOffset = comp?.mediaOffset || 0;
    const duration = activeClip.duration || 0;
 
    return { url, filePath, mediaOffset, duration, assetDuration: asset?.duration || 0 };
  }, [activeClip, mediaAssets]);

  // Long media (by SOURCE duration, not trimmed clip duration — that is what
  // a whole-file decode would cost) forces the native FFmpeg engine and
  // disables the in-memory decode/audition path on desktop.
  const longClipNeedsFfmpeg =
    isTauri() && (audioSourceInfo?.assetDuration || 0) > LONG_CLIP_DECODE_LIMIT_SEC;
 
  // Load AudioBuffer for client-side preview, Web Audio detection, and auditioning
  useEffect(() => {
    if (!isEnabled || !audioSourceInfo?.url) {
      setAudioBuffer(null);
      return;
    }
 
    // Desktop + long source: don't decode the whole file. Detection below
    // uses FFmpeg, and the in-memory audition player is unavailable for it.
    if (longClipNeedsFfmpeg) {
      setAudioBuffer(null);
      setIsLoadingAudio(false);
      return;
    }
 
    let cancelled = false;
    setIsLoadingAudio(true);
 
    decodeAudio(audioSourceInfo.url)
      .then((buf) => {
        if (!cancelled) {
          setAudioBuffer(buf);
          setIsLoadingAudio(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[SilenceRemoverPanel] Audio decode failed:', err);
          setIsLoadingAudio(false);
        }
      });
 
    return () => {
      cancelled = true;
    };
  }, [isEnabled, audioSourceInfo?.url, longClipNeedsFfmpeg]);
 
  // Detection execution
  useEffect(() => {
    if (!isEnabled || !activeClip) {
      setRawSilenceIntervals([]);
      return;
    }
 
    // The native engine is used when the user opted in, OR when a long
    // source makes the in-memory analyzer impossible (desktop build).
    const useNativeEngine =
      (useFfmpegEngine || longClipNeedsFfmpeg)
      && ffmpegSupported
      && Boolean(audioSourceInfo?.filePath);

    if (useNativeEngine) {
      let cancelled = false;
      setIsDetecting(true);
      detectSilenceWithFfmpeg({
        filePath: audioSourceInfo.filePath,
        thresholdDb,
        minSilenceDuration,
        mediaOffset: audioSourceInfo.mediaOffset,
        duration: audioSourceInfo.duration,
      })
        .then((intervals) => {
          if (!cancelled) {
            setRawSilenceIntervals(intervals);
            setIsDetecting(false);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('[SilenceRemoverPanel] FFmpeg detection fallback to Web Audio:', err);
            if (audioBuffer) {
              const res = detectSilenceWithWebAudio(audioBuffer, {
                thresholdDb,
                minSilenceDuration,
                mediaOffset: audioSourceInfo.mediaOffset,
                duration: audioSourceInfo.duration,
              });
              setRawSilenceIntervals(res);
            }
            setIsDetecting(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }
 
    // Default: Fast Web Audio detection
    if (audioBuffer) {
      const intervals = detectSilenceWithWebAudio(audioBuffer, {
        thresholdDb,
        minSilenceDuration,
        mediaOffset: audioSourceInfo?.mediaOffset || 0,
        duration: audioSourceInfo?.duration || activeClip.duration,
      });
      setRawSilenceIntervals(intervals);
    }
  }, [
    isEnabled,
    activeClip,
    audioBuffer,
    audioSourceInfo,
    thresholdDb,
    minSilenceDuration,
    useFfmpegEngine,
    ffmpegSupported,
    longClipNeedsFfmpeg,
  ]);
 
  // Calculate audible & silent segments with padding
  const computed = useMemo(() => {
    if (!activeClip) {
      return { cutSegments: [], keptSegments: [], originalDuration: 0, newDuration: 0, savedDuration: 0, savedPercent: 0 };
    }
    const filteredRaw = rawSilenceIntervals.filter((_, idx) => !disabledCutIds.has(idx));
    return computeAudibleAndSilentSegments(filteredRaw, activeClip.duration, {
      padding,
      minSpeechDuration,
    });
  }, [activeClip, rawSilenceIntervals, disabledCutIds, padding, minSpeechDuration]);
 
  // A fresh detection run (new raw intervals) invalidates any manual edge
  // drags from before — those overrides were keyed to the previous run's
  // cut ids/positions and no longer correspond to anything meaningful.
  useEffect(() => {
    setManualCutOverrides({});
  }, [rawSilenceIntervals]);
 
  // Cuts actually shown/used everywhere below: computed.cutSegments with
  // any manual edge drags applied on top, re-clamped to stay inside the
  // clip and never invert (end before start).
  const displayCutSegments = useMemo(() => {
    if (Object.keys(manualCutOverrides).length === 0) return computed.cutSegments;
    const clipDur = activeClip?.duration || 0;
    return computed.cutSegments.map((cut) => {
      const override = manualCutOverrides[cut.id];
      if (!override) return cut;
      const start = Math.max(0, Math.min(override.start, clipDur));
      const end = Math.max(start + 0.02, Math.min(override.end, clipDur));
      return { ...cut, start, end, duration: Math.round((end - start) * 1000) / 1000 };
    });
  }, [computed.cutSegments, manualCutOverrides, activeClip]);
 
  // Called by the timeline's cut-edge drag handles (ClipItem) as the user
  // drags a cut region's left/right edge. Merges into manualCutOverrides
  // rather than mutating computed.cutSegments directly, since the latter
  // is re-derived from scratch on every threshold/padding change.
  const handleAdjustCutEdge = useCallback((cutId, edge, newTime) => {
    setManualCutOverrides((prev) => {
      const base = computed.cutSegments.find((c) => c.id === cutId);
      if (!base) return prev;
      const existing = prev[cutId] || { start: base.start, end: base.end };
      const next = { ...existing, [edge]: newTime };
      // Keep start < end with a small minimum width so a cut can't be
      // dragged past/through itself.
      if (edge === 'start') next.start = Math.min(next.start, next.end - 0.02);
      if (edge === 'end') next.end = Math.max(next.end, next.start + 0.02);
      return { ...prev, [cutId]: next };
    });
  }, [computed.cutSegments]);
 
  // Broadcast cut preview data to the Timeline for live on-timeline clip overlays.
  // Gated on isEnabled — this is the effect that actually paints cut
  // regions onto the real timeline, so it's the one that most needed to
  // stop running just because the panel happened to be open.
  useEffect(() => {
    if (onUpdatePreviewCuts) {
      if (isEnabled && targetType === 'clip' && activeClip) {
        onUpdatePreviewCuts({
          targetType: 'clip',
          targetId: activeClip.id,
          cuts: displayCutSegments,
          onAdjustCutEdge: handleAdjustCutEdge,
        });
      } else if (isEnabled && targetType === 'track' && selectedTrackId) {
        onUpdatePreviewCuts({
          targetType: 'track',
          targetId: selectedTrackId,
          cuts: displayCutSegments,
          onAdjustCutEdge: handleAdjustCutEdge,
        });
      } else {
        onUpdatePreviewCuts(null);
      }
    }
  }, [isEnabled, onUpdatePreviewCuts, targetType, activeClip, selectedTrackId, displayCutSegments, handleAdjustCutEdge]);
 
  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (onUpdatePreviewCuts) {
        onUpdatePreviewCuts(null);
      }
    };
  }, [onUpdatePreviewCuts]);
 
  // ── Live Audition Player (skips silent cut intervals in real time) ─────────
  const stopAudition = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore already stopped
      }
      sourceNodeRef.current = null;
    }
    if (auditionRafRef.current) {
      cancelAnimationFrame(auditionRafRef.current);
      auditionRafRef.current = null;
    }
    setIsAuditioning(false);
  }, []);
 
  const startAudition = useCallback(
    (startTime = 0) => {
      if (!audioBuffer) return;
      stopAudition();
 
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
 
      const mediaOffset = audioSourceInfo?.mediaOffset || 0;
      const clipDuration = activeClip?.duration || audioBuffer.duration;
      const safeStart = Math.max(0, Math.min(startTime, clipDuration - 0.1));
 
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
 
      const cuts = displayCutSegments;
 
      // Start playing
      const bufferStartTime = mediaOffset + safeStart;
      source.start(0, bufferStartTime);
      sourceNodeRef.current = source;
 
      auditionStartWallTimeRef.current = ctx.currentTime;
      auditionStartAudioTimeRef.current = safeStart;
      setIsAuditioning(true);
 
      const loop = () => {
        if (!sourceNodeRef.current) return;
        const elapsed = ctx.currentTime - auditionStartWallTimeRef.current;
        const currentAudioTime = auditionStartAudioTimeRef.current + elapsed;
 
        if (currentAudioTime >= clipDuration) {
          stopAudition();
          setAuditionCurrentTime(0);
          return;
        }
 
        // Check if inside a cut interval -> skip forward past the silence
        for (const cut of cuts) {
          if (currentAudioTime >= cut.start && currentAudioTime < cut.end) {
            // Jump ahead to cut.end
            stopAudition();
            startAudition(cut.end + 0.01);
            return;
          }
        }
 
        setAuditionCurrentTime(currentAudioTime);
        auditionRafRef.current = requestAnimationFrame(loop);
      };
 
      auditionRafRef.current = requestAnimationFrame(loop);
 
      source.onended = () => {
        setIsAuditioning(false);
      };
    },
    [audioBuffer, audioSourceInfo, activeClip, displayCutSegments, stopAudition]
  );
 
  const toggleAudition = () => {
    if (isAuditioning) {
      stopAudition();
    } else {
      startAudition(auditionCurrentTime > 0 ? auditionCurrentTime : 0);
    }
  };
 
  // Stop audition when clip changes
  useEffect(() => {
    stopAudition();
    setAuditionCurrentTime(0);
  }, [activeClip?.id, stopAudition]);
 
  // Toggle individual cut checkbox
  const handleToggleCut = useCallback((idx) => {
    setDisabledCutIds((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);
 
  // Presets
  const applyPreset = (preset) => {
    if (preset === 'gentle') {
      setThresholdDb(-45);
      setMinSilenceDuration(0.5);
      setPadding(0.12);
    } else if (preset === 'normal') {
      setThresholdDb(-35);
      setMinSilenceDuration(0.4);
      setPadding(0.08);
    } else if (preset === 'aggressive') {
      setThresholdDb(-25);
      setMinSilenceDuration(0.25);
      setPadding(0.04);
    }
  };
 
  // Commit Cut Silence
  // Kept (audible) segments recomputed from displayCutSegments so manual
  // edge drags actually change what handleApply cuts, not just the
  // preview overlay on the timeline.
  const displayKeptSegments = useMemo(() => {
    const clipDur = activeClip?.duration || 0;
    if (clipDur <= 0) return [];
    const sorted = [...displayCutSegments].sort((a, b) => a.start - b.start);
    const kept = [];
    let curTime = 0;
    for (const cut of sorted) {
      if (cut.start > curTime + 0.02) {
        kept.push({
          start: Math.round(curTime * 1000) / 1000,
          end: Math.round(cut.start * 1000) / 1000,
          duration: Math.round((cut.start - curTime) * 1000) / 1000,
        });
      }
      curTime = Math.max(curTime, cut.end);
    }
    if (curTime < clipDur - 0.02) {
      kept.push({
        start: Math.round(curTime * 1000) / 1000,
        end: Math.round(clipDur * 1000) / 1000,
        duration: Math.round((clipDur - curTime) * 1000) / 1000,
      });
    }
    return kept;
  }, [displayCutSegments, activeClip]);
 
  const handleApply = () => {
    if (!isEnabled) return;
    stopAudition();
    if (!onApplyCutSilence) return;
 
    if (targetType === 'clip' && activeClip) {
      onApplyCutSilence({
        targetType: 'clip',
        targetId: activeClip.id,
        keptSegments: displayKeptSegments,
        ripple: rippleMode,
      });
    } else if (targetType === 'track' && selectedTrackId) {
      const cutsByClipId = new Map();
      if (activeClip && activeClip.trackId === selectedTrackId) {
        cutsByClipId.set(activeClip.id, displayKeptSegments);
      }
      onApplyCutSilence({
        targetType: 'track',
        targetId: selectedTrackId,
        cutsByClipId,
        ripple: rippleMode,
      });
    }
  };
 
  return (
    <div className="silence-panel-container">
      {/* Enable / Disable — master switch for the whole panel. Off by
          default and on every mount; detection, auditioning, and the
          live timeline-cut overlay only run while this is on. */}
      <div className="silence-enable-bar">
        <label className="silence-enable-toggle">
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
            />
            <span className="toggle-switch-track">
              <span className="toggle-switch-thumb" />
            </span>
          </span>
          <span className="silence-enable-label">
            <Scissors size={12} />
            Silence Remover
          </span>
        </label>
        <span className={`silence-enable-status ${isEnabled ? 'on' : 'off'}`}>
          {isEnabled ? 'Active — editing timeline' : 'Off'}
        </span>
      </div>
 
      <div className={`silence-panel-body ${!isEnabled ? 'is-disabled' : ''}`}>
      {/* Top Bar / Target Selector */}
      <div className="silence-panel-topbar">
        <div className="silence-target-tabs">
          <button
            type="button"
            className={`silence-tab-btn ${targetType === 'clip' ? 'active' : ''}`}
            onClick={() => setTargetType('clip')}
            disabled={!isEnabled}
          >
            {activeClip?.type === 'video' ? <Film size={12} /> : <Music size={12} />}
            Selected Clip
          </button>
          <button
            type="button"
            className={`silence-tab-btn ${targetType === 'track' ? 'active' : ''}`}
            onClick={() => setTargetType('track')}
            disabled={!isEnabled}
          >
            <Layers size={12} />
            Entire Track
          </button>
        </div>
 
        <div className="silence-target-select-wrap">
          {targetType === 'clip' ? (
            <select
              className="silence-select-input"
              value={selectedClipId || ''}
              onChange={(e) => setSelectedClipId(e.target.value)}
              disabled={!isEnabled}
            >
              {audioVideoClips.length === 0 && <option value="">No audio/video clips</option>}
              {audioVideoClips.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.duration.toFixed(1)}s)
                </option>
              ))}
            </select>
          ) : (
            <select
              className="silence-select-input"
              value={selectedTrackId || ''}
              onChange={(e) => setSelectedTrackId(e.target.value)}
              disabled={!isEnabled}
            >
              {allTracks.length === 0 && <option value="">No tracks</option>}
              {allTracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
 
      {/* Summary Metrics Banner */}
      <div className="silence-metrics-banner">
        <div className="metric-chip">
          <span className="metric-label">Pauses Found</span>
          <span className="metric-val text-amber">{computed.cutSegments.length}</span>
        </div>
        <div className="metric-chip">
          <span className="metric-label">Time Saved</span>
          <span className="metric-val text-rose">
            -{computed.savedDuration.toFixed(2)}s ({computed.savedPercent}%)
          </span>
        </div>
        <div className="metric-chip">
          <span className="metric-label">New Duration</span>
          <span className="metric-val text-emerald">
            {formatTime(computed.newDuration)}
          </span>
        </div>
      </div>
 
      {/* Audition Player & On-Timeline Indicator */}
      <div className="silence-audition-card">
        <div className="audition-header">
          <div className="audition-title">
            <Volume2 size={13} className="text-cyan" />
            <span>Audition (Silence Skipped)</span>
          </div>
          <span className="audition-time text-dim">
            {formatTime(auditionCurrentTime)} / {formatTime(activeClip?.duration || 0)}
          </span>
        </div>
 
        <div className="audition-controls">
          <button
            type="button"
            className={`audition-play-btn ${isAuditioning ? 'playing' : ''}`}
            onClick={toggleAudition}
            disabled={!isEnabled || !audioBuffer}
            title={isAuditioning ? 'Pause Audition' : 'Play and skip detected silence in real time'}
          >
            {isAuditioning ? <Pause size={13} /> : <Play size={13} />}
            {isAuditioning ? 'Pause' : 'Audition Result'}
          </button>
 
          <button
            type="button"
            className="audition-reset-btn"
            onClick={() => {
              stopAudition();
              setAuditionCurrentTime(0);
            }}
            disabled={!isEnabled}
            title="Reset playback to beginning"
          >
            <RotateCcw size={11} />
          </button>
 
          <div className={`timeline-sync-badge ${!isEnabled ? 'inactive' : ''}`} title={isEnabled ? 'Red cut regions are displayed live on the actual timeline clips' : 'Turn on Silence Remover to preview cuts on the timeline'}>
            <span className="live-indicator-dot" />
            <span>{isEnabled ? 'Live on Timeline' : 'Not Active'}</span>
          </div>
        </div>
      </div>
 
      {/* Scrollable Controls Section */}
      <div className="silence-panel-scroll-area">
        {/* Preset Chips */}
        <div className="silence-presets-row">
          <span className="presets-caption">Presets:</span>
          <button
            type="button"
            className={`preset-btn ${thresholdDb === -45 ? 'active' : ''}`}
            onClick={() => applyPreset('gentle')}
            disabled={!isEnabled}
          >
            Gentle (-45dB)
          </button>
          <button
            type="button"
            className={`preset-btn ${thresholdDb === -35 ? 'active' : ''}`}
            onClick={() => applyPreset('normal')}
            disabled={!isEnabled}
          >
            Balanced (-35dB)
          </button>
          <button
            type="button"
            className={`preset-btn ${thresholdDb === -25 ? 'active' : ''}`}
            onClick={() => applyPreset('aggressive')}
            disabled={!isEnabled}
          >
            Aggressive (-25dB)
          </button>
        </div>
 
        {/* Slider 1: Threshold (dB) */}
        <div className="silence-control-card">
          <div className="control-header">
            <div className="control-label">
              <Volume2 size={12} className="text-cyan" />
              <span>Noise Threshold</span>
            </div>
            <span className="control-readout">{thresholdDb} dB</span>
          </div>
          <input
            type="range"
            min="-60"
            max="-15"
            step="1"
            value={thresholdDb}
            onChange={(e) => setThresholdDb(parseFloat(e.target.value))}
            className="silence-slider"
            disabled={!isEnabled}
          />
          <span className="control-desc">
            Sounds below this volume level are treated as silence.
          </span>
        </div>
 
        {/* Slider 2: Min Silence Duration */}
        <div className="silence-control-card">
          <div className="control-header">
            <div className="control-label">
              <Clock size={12} className="text-amber" />
              <span>Min Silence Duration</span>
            </div>
            <span className="control-readout">{minSilenceDuration.toFixed(2)}s</span>
          </div>
          <input
            type="range"
            min="0.10"
            max="1.50"
            step="0.05"
            value={minSilenceDuration}
            onChange={(e) => setMinSilenceDuration(parseFloat(e.target.value))}
            className="silence-slider"
            disabled={!isEnabled}
          />
          <span className="control-desc">
            Pauses shorter than this are kept to preserve natural pauses.
          </span>
        </div>
 
        {/* Slider 3: Padding / Offset */}
        <div className="silence-control-card">
          <div className="control-header">
            <div className="control-label">
              <Sliders size={12} className="text-emerald" />
              <span>Padding / Offset Buffer</span>
            </div>
            <span className="control-readout">{padding.toFixed(2)}s</span>
          </div>
          <input
            type="range"
            min="0.00"
            max="0.30"
            step="0.01"
            value={padding}
            onChange={(e) => setPadding(parseFloat(e.target.value))}
            className="silence-slider"
            disabled={!isEnabled}
          />
          <span className="control-desc">
            Lead-in &amp; lead-out margins to prevent cutting word edges.
          </span>
        </div>
 
        {/* Ripple & Engine Checkboxes */}
        <div className="silence-toggles-card">
          <label className="silence-toggle-item">
            <input
              type="checkbox"
              checked={rippleMode}
              onChange={(e) => setRippleMode(e.target.checked)}
              disabled={!isEnabled}
            />
            <span>Ripple Cut (Close gaps between cuts)</span>
          </label>
 
          {ffmpegSupported && (
            <label className="silence-toggle-item">
              <input
                type="checkbox"
                checked={useFfmpegEngine || longClipNeedsFfmpeg}
                onChange={(e) => setUseFfmpegEngine(e.target.checked)}
                disabled={!isEnabled || longClipNeedsFfmpeg}
              />
              <span>
                <Cpu size={11} style={{ display: 'inline', marginRight: 4 }} />
                Use Native FFmpeg Engine
              </span>
            </label>
          )}
        </div>
 
        {/* Detected Pauses Checklist */}
        <div className="silence-pauses-section">
          <div className="pauses-section-header">
            <span>Detected Pauses ({rawSilenceIntervals.length})</span>
            <span className="pauses-section-sub">Uncheck to keep</span>
          </div>
 
          <div className="pauses-list">
            {rawSilenceIntervals.length === 0 ? (
              <div className="pauses-empty-state">
                No silence detected with current settings.
                <br />
                Try raising threshold dB or lowering min duration.
              </div>
            ) : (
              rawSilenceIntervals.map((interval, idx) => {
                const isChecked = !disabledCutIds.has(idx);
                return (
                  <div
                    key={idx}
                    className={`pause-entry ${isChecked ? 'cut' : 'kept'}`}
                    onClick={() => isEnabled && handleToggleCut(idx)}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      onClick={(e) => e.stopPropagation()}
                      disabled={!isEnabled}
                    />
                    <div className="pause-time">
                      <span>{formatTime(interval.start)}</span>
                      <ArrowRight size={9} />
                      <span>{formatTime(interval.end)}</span>
                      <span className="pause-length">({interval.duration.toFixed(2)}s)</span>
                    </div>
                    <span className={`pause-badge ${isChecked ? 'badge-cut' : 'badge-keep'}`}>
                      {isChecked ? 'Cut' : 'Keep'}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
 
      {/* Action Footer */}
      <div className="silence-panel-footer">
        <button
          type="button"
          className="silence-cut-action-btn"
          onClick={handleApply}
          disabled={!isEnabled || computed.cutSegments.length === 0}
        >
          <Scissors size={13} />
          Cut Silence ({computed.cutSegments.length} pauses)
        </button>
      </div>
      </div>
    </div>
  );
});