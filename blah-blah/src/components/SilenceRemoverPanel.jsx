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
import { decodeAudio } from '../utils/audioWaveform';
import {
  detectSilenceWithWebAudio,
  detectSilenceWithFfmpeg,
  computeAudibleAndSilentSegments,
  formatTime,
  isTauri,
  isFfmpegAvailable,
} from '../services/silenceDetector';
import './silence-remover-panel.css';

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
  const [targetType, setTargetType] = useState(activeTargetType);
  const [selectedClipId, setSelectedClipId] = useState(activeTargetId);
  const [selectedTrackId, setSelectedTrackId] = useState(null);

  // Settings
  const [thresholdDb, setThresholdDb] = useState(-35);
  const [minSilenceDuration, setMinSilenceDuration] = useState(0.4);
  const [padding, setPadding] = useState(0.08); // 80ms offset / padding
  const [minSpeechDuration, setMinSpeechDuration] = useState(0.15);
  const [rippleMode, setRippleMode] = useState(true);
  const [useFfmpegEngine, setUseFfmpegEngine] = useState(false);
  const [disabledCutIds, setDisabledCutIds] = useState(new Set());

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

    // Resolve matching asset for disk file path (Tauri mode)
    const asset = mediaAssets.find((a) => a.url === url || a.name === activeClip.name || url?.includes(a.name));
    if (asset?.path) filePath = asset.path;

    const mediaOffset = comp?.mediaOffset || 0;
    const duration = activeClip.duration || 0;

    return { url, filePath, mediaOffset, duration };
  }, [activeClip, mediaAssets]);

  // Load AudioBuffer for client-side preview, Web Audio detection, and auditioning
  useEffect(() => {
    if (!audioSourceInfo?.url) {
      setAudioBuffer(null);
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
  }, [audioSourceInfo?.url]);

  // Detection execution
  useEffect(() => {
    if (!activeClip) {
      setRawSilenceIntervals([]);
      return;
    }

    if (useFfmpegEngine && ffmpegSupported && audioSourceInfo?.filePath) {
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
    activeClip,
    audioBuffer,
    audioSourceInfo,
    thresholdDb,
    minSilenceDuration,
    useFfmpegEngine,
    ffmpegSupported,
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

  // Broadcast cut preview data to the Timeline for live on-timeline clip overlays
  useEffect(() => {
    if (onUpdatePreviewCuts) {
      if (targetType === 'clip' && activeClip) {
        onUpdatePreviewCuts({
          targetType: 'clip',
          targetId: activeClip.id,
          cuts: computed.cutSegments,
        });
      } else if (targetType === 'track' && selectedTrackId) {
        onUpdatePreviewCuts({
          targetType: 'track',
          targetId: selectedTrackId,
          cuts: computed.cutSegments,
        });
      } else {
        onUpdatePreviewCuts(null);
      }
    }
  }, [onUpdatePreviewCuts, targetType, activeClip, selectedTrackId, computed.cutSegments]);

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

      const cuts = computed.cutSegments;

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
    [audioBuffer, audioSourceInfo, activeClip, computed.cutSegments, stopAudition]
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
  const handleApply = () => {
    stopAudition();
    if (!onApplyCutSilence) return;

    if (targetType === 'clip' && activeClip) {
      onApplyCutSilence({
        targetType: 'clip',
        targetId: activeClip.id,
        keptSegments: computed.keptSegments,
        ripple: rippleMode,
      });
    } else if (targetType === 'track' && selectedTrackId) {
      const cutsByClipId = new Map();
      if (activeClip && activeClip.trackId === selectedTrackId) {
        cutsByClipId.set(activeClip.id, computed.keptSegments);
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
      {/* Top Bar / Target Selector */}
      <div className="silence-panel-topbar">
        <div className="silence-target-tabs">
          <button
            type="button"
            className={`silence-tab-btn ${targetType === 'clip' ? 'active' : ''}`}
            onClick={() => setTargetType('clip')}
          >
            {activeClip?.type === 'video' ? <Film size={12} /> : <Music size={12} />}
            Selected Clip
          </button>
          <button
            type="button"
            className={`silence-tab-btn ${targetType === 'track' ? 'active' : ''}`}
            onClick={() => setTargetType('track')}
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
            disabled={!audioBuffer}
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
            title="Reset playback to beginning"
          >
            <RotateCcw size={11} />
          </button>

          <div className="timeline-sync-badge" title="Red cut regions are displayed live on the actual timeline clips">
            <span className="live-indicator-dot" />
            <span>Live on Timeline</span>
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
          >
            Gentle (-45dB)
          </button>
          <button
            type="button"
            className={`preset-btn ${thresholdDb === -35 ? 'active' : ''}`}
            onClick={() => applyPreset('normal')}
          >
            Balanced (-35dB)
          </button>
          <button
            type="button"
            className={`preset-btn ${thresholdDb === -25 ? 'active' : ''}`}
            onClick={() => applyPreset('aggressive')}
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
            />
            <span>Ripple Cut (Close gaps between cuts)</span>
          </label>

          {ffmpegSupported && (
            <label className="silence-toggle-item">
              <input
                type="checkbox"
                checked={useFfmpegEngine}
                onChange={(e) => setUseFfmpegEngine(e.target.checked)}
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
                    onClick={() => handleToggleCut(idx)}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      onClick={(e) => e.stopPropagation()}
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
          disabled={computed.cutSegments.length === 0}
        >
          <Scissors size={13} />
          Cut Silence ({computed.cutSegments.length} pauses)
        </button>
      </div>
    </div>
  );
});
