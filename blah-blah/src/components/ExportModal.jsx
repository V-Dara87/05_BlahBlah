import { useState, useRef, useEffect } from 'react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import {
  Download,
  FolderOpen,
  X,
  Film,
  CheckCircle2,
  Sparkles,
  AlertCircle,
  Clock,
  Layers,
  Settings,
  HardDrive,
  Tv,
  Volume2,
  Cpu
} from 'lucide-react';
import { formatTimecode } from '../utils/timeFormat';
import { isTauri } from '../services/tauriFsAdapter';
import {
  drawExportFrame,
  createCanvasContainerPool,
  createVideoFrameProvider,
  computeActiveEntitiesAtTime,
  mixdownAudio,
  encodeAudioTrack,
} from '../engine/exportRunner';
import {
  FFMPEG_FORMATS,
  FFMPEG_QUALITY_PRESETS,
  executeFfmpegExport,
  isFfmpegAvailable
} from '../services/ffmpegExportRunner';
 
/**
 * P1 #11 — MP4 export. Video is the original deterministic frame-by-frame
 * render; audio is now mixed down and muxed in too (Phase 2, see
 * mixdownAudio/encodeAudioTrack in exportRunner.js for the actual work).
 *
 * This is a deterministic frame-by-frame render, NOT a live real-time
 * recording. Per the roadmap: export renders off `time`/`frame` values the
 * same way Remotion does — a pure function of frame number, with no
 * wall-clock playback and no real time elapsing between frames. The
 * previous implementation here drove a live `requestAnimationFrame` loop
 * into `MediaRecorder` + `canvas.captureStream()`, which is exactly the
 * approach the roadmap flags as wrong for this: any dropped/late frame
 * during rendering bakes irreversibly into the recording, and render time
 * is locked to real video duration with no way to speed it up. This
 * version iterates frame index `i` from 0 to the last frame explicitly,
 * computes `time = i / fps` for each one, and forces the render tree to
 * draw exactly that snapshot — a slow frame just makes export take longer,
 * it never skips or duplicates a frame in the output.
 *
 * Frame drawing itself is delegated to engine/exportRunner.js, which reuses
 * the same script-evaluation and CanvasRenderer mount/update functions
 * EntityRenderer.jsx drives for live playback (see that file's header
 * comment) — so any renderer type EntityRenderer already supports via
 * those functions is automatically supported here too, with no
 * export-specific branch needed for its motion/canvas-script behavior.
 *
 * Encoding uses the WebCodecs `VideoEncoder` + the already-installed
 * `mp4-muxer` package (not ffmpeg.wasm) — frames are encoded and muxed as
 * they're produced rather than held in memory as raw bitmaps, which keeps
 * memory roughly flat regardless of export length (the roadmap's "don't
 * make the known ffmpeg.wasm-class memory weak point needlessly worse"
 * constraint, satisfied by not going through ffmpeg.wasm's own frame
 * buffering at all).
 */
 
// Sample rate used for the offline audio mixdown + AAC encode below.
// 48kHz matches what browsers' AudioEncoder AAC implementations expect and
// is the standard rate for video-with-audio delivery.
const AUDIO_SAMPLE_RATE = 48000;
 
export function ExportModal({
  isOpen,
  onClose,
  projectName,
  clips,
  tracks,
  scripts = [],
  totalDuration,
  resolution,
  exportRange,
  // Real-import support: awaited once at export start so every script's
  // async bundle has landed before the (synchronous) frame loop reads the
  // compile cache — a script using `import` would otherwise render in its
  // untransformed/pending state for the whole export.
  onBeforeExport,
}) {
  // Default to the project's own resolution whenever it has one — a
  // portrait (or any non-1080p-landscape) project shouldn't silently open
  // this modal pre-selected to 1080p landscape. Falls back to '1080p' only
  // when the project genuinely has no resolution set yet.
  const [preset, setPreset] = useState(
    resolution?.width > 0 && resolution?.height > 0 ? 'project' : '1080p'
  ); // '720p' | '1080p' | '4k' | 'project'
  const [fps, setFps] = useState('30');
  const [quality, setQuality] = useState('high');

  // Export engine: 'webcodecs' (default/browser) or 'ffmpeg' (Tauri sidecar)
  const [engine, setEngine] = useState('webcodecs');
  const [ffmpegFormat, setFfmpegFormat] = useState('mp4_h264');
  const [ffmpegQuality, setFfmpegQuality] = useState('high');
  const [ffmpegAvailable, setFfmpegAvailable] = useState(false);
  const [exportPhase, setExportPhase] = useState('rendering'); // 'rendering' | 'ffmpeg'
  const [ffmpegProgressDetail, setFfmpegProgressDetail] = useState(null);
 
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState(null);
  // Tauri: absolute path the finished MP4 was saved to (native save
  // dialog), which powers the "Show in Explorer" action on the success
  // card. Web fallback keeps downloadUrl + the <a download> anchor.
  const [savedFilePath, setSavedFilePath] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  // 'idle' | 'mixing' | 'mixed' | 'encoding' | 'silent'
  const [audioStatus, setAudioStatus] = useState('idle');
 
  const previewCanvasRef = useRef(null);
  const abortRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    (async () => {
      try {
        const available = await isFfmpegAvailable();
        if (mounted) {
          setFfmpegAvailable(available);
          if (available && isTauri()) {
            // Optional: keep webcodecs as initial option or let user toggle
          }
        }
      } catch {
        if (mounted) setFfmpegAvailable(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [isOpen]);
 
  if (!isOpen) return null;
 
  const isFfmpegEngine = engine === 'ffmpeg' && isTauri() && ffmpegAvailable;
  const selectedFfmpegFormat = FFMPEG_FORMATS[ffmpegFormat] || FFMPEG_FORMATS.mp4_h264;
  const format = isFfmpegEngine ? selectedFfmpegFormat.extension : 'mp4';

  const targetFps = parseInt(fps) || 30;
  // Use export range if set, otherwise full duration
  const exportStartTime = exportRange?.in ?? 0;
  const exportEndTime = exportRange?.out ?? totalDuration;
  const exportDuration = Math.max(1 / targetFps, (exportEndTime - exportStartTime) || 0);
  const totalFrames = Math.max(1, Math.ceil(exportDuration * targetFps));
  const hasRange = !!exportRange;
 
  const hasProjectRes = resolution?.width > 0 && resolution?.height > 0;
  const width =
    preset === '4k' ? 3840 : preset === '1080p' ? 1920 : preset === 'project' && hasProjectRes ? resolution.width : 1280;
  const height =
    preset === '4k' ? 2160 : preset === '1080p' ? 1080 : preset === 'project' && hasProjectRes ? resolution.height : 720;
  // WebCodecs H.264 requires even dimensions.
  const encodeWidth = width % 2 === 0 ? width : width - 1;
  const encodeHeight = height % 2 === 0 ? height : height - 1;
 
  const bitrateMbps = quality === 'ultra' ? 16 : quality === 'high' ? 8 : 4;
  let estMbps = bitrateMbps;
  if (isFfmpegEngine) {
    if (ffmpegFormat === 'mov_prores') estMbps = 150;
    else if (ffmpegFormat === 'mp4_h265') {
      estMbps = ffmpegQuality === 'ultra' ? 10 : ffmpegQuality === 'high' ? 5 : 2.5;
    } else if (ffmpegFormat === 'webm_vp9') {
      estMbps = ffmpegQuality === 'ultra' ? 12 : ffmpegQuality === 'high' ? 6 : 3;
    } else if (ffmpegFormat === 'gif') {
      estMbps = 20;
    } else {
      estMbps = ffmpegQuality === 'ultra' ? 16 : ffmpegQuality === 'high' ? 8 : 4;
    }
  }
  const estSizeBytes = (estMbps * 1_000_000 / 8) * exportDuration;
  const estSizeMB = (estSizeBytes / (1024 * 1024)).toFixed(1);
 
  // Pre-export preview only — a coarse "does this project have anything
  // that could produce sound" check (ignores overlap with the export
  // range/mediaOffset trims, which the real mixdown accounts for exactly).
  // Good enough for the summary badge; the real answer is audioStatus once
  // handleStartExport actually runs mixdownAudio.
  const hasAnyAudioSource = clips.some((c) => {
    const audioComp = c.components?.find((comp) => comp.type === 'AudioSource');
    const videoComp = c.components?.find((comp) => comp.type === 'VideoRenderer');
    if (audioComp && (audioComp.volume ?? 1) > 0) return true;
    if (videoComp && (videoComp.volume ?? 0) > 0) return true;
    return false;
  });
  const audioSupported = typeof AudioEncoder !== 'undefined';
 
  const handleCancelExport = () => {
    abortRef.current = true;
  };
 
  const handleRevealSavedFile = async () => {
    try {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
      await revealItemInDir(savedFilePath);
    } catch (err) {
      console.warn('Could not reveal exported file in Explorer:', err);
    }
  };

  const handleStartExport = async () => {
    setIsExporting(true);
    setProgress(0);
    setCurrentSec(0);
    setDownloadUrl(null);
    setSavedFilePath(null);
    setErrorMessage(null);
    abortRef.current = false;

    // Tauri: ask where the finished video should live BEFORE doing any
    // render work (native "Save As" dialog). Cancelling aborts the whole
    // export — no point rendering something the user then can't place.
    let savePath = null;
    let tempIntermediatePath = null;
    if (isTauri()) {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const ext = format;
        const defaultFileName = `${(projectName || 'blahblah-video').replace(/[\\/:*?"<>|]/g, '-')}_${encodeWidth}x${encodeHeight}.${ext}`;
        const filterName = isFfmpegEngine ? selectedFfmpegFormat.label : 'MP4 Video';
        savePath = await save({
          title: 'Save Rendered Video',
          defaultPath: defaultFileName,
          filters: [{ name: filterName, extensions: [ext] }],
        });
        if (!savePath) {
          setIsExporting(false);
          return;
        }
        if (isFfmpegEngine) {
          tempIntermediatePath = `${savePath}.intermediate.mp4`;
        }
      } catch (err) {
        console.error('Save dialog error:', err);
        setErrorMessage(`Could not open the save dialog: ${err.message || err}`);
        setIsExporting(false);
        return;
      }
    }
 
    const canvasContainers = createCanvasContainerPool();
    const videoFrameProvider = createVideoFrameProvider();

    // Ensure any import-using scripts are bundled before the frame loop
    // starts (no-op when everything is already compiled or import-free).
    try {
      await onBeforeExport?.();
    } catch (err) {
      console.warn('Export: pre-compile pass failed, exporting with whatever is already compiled:', err);
    }
 
    // Offscreen render target — never attached to the page. The small
    // <canvas> in the "rendering" UI state below is a separate, cheap
    // live-progress preview, not the actual capture surface.
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = encodeWidth;
    renderCanvas.height = encodeHeight;
    const ctx = renderCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
 
    let videoEncoder = null;
    let muxer = null;
    setAudioStatus('mixing');
 
    try {
      if (typeof VideoEncoder === 'undefined') {
        throw new Error('This browser does not support WebCodecs (VideoEncoder), which MP4 export requires.');
      }
 
      // 1. Preload every video source once, up front — not per-frame, so
      // a slow-loading source doesn't stall in the middle of the frame
      // loop and so the per-frame loop below can stay purely a seek+draw.
      const videoEntities = clips.filter(
        (c) => c.type === 'video' || c.components?.some((comp) => comp.type === 'VideoRenderer')
      );
      await Promise.all(
        videoEntities.map((c) => {
          const videoComp = c.components?.find((comp) => comp.type === 'VideoRenderer');
          const src = videoComp?.src || c.src;
          return src ? videoFrameProvider.preload(c.id, src) : Promise.resolve();
        })
      );
 
      // 1b. Mix every AudioSource / audible VideoRenderer down into one
      // deterministic buffer before the frame loop starts. Doing this
      // up front (rather than interleaved with per-frame video work) keeps
      // the mixdown itself a single pure render over the whole export
      // window, same "explicit time range in, one buffer out" contract as
      // computeActiveEntitiesAtTime is for a single frame. Decode/encode
      // failures degrade to a silent export rather than aborting it — a
      // broken audio source shouldn't block getting the video.
      let mixedAudioBuffer = null;
      const hasWebCodecsAudio = typeof AudioEncoder !== 'undefined';
      if (!hasWebCodecsAudio) {
        console.warn('Export audio: this browser does not support WebCodecs AudioEncoder — exporting video only.');
      }
      if (hasWebCodecsAudio) {
        try {
          mixedAudioBuffer = await mixdownAudio({
            entities: clips,
            exportStartTime,
            exportDuration,
            sampleRate: AUDIO_SAMPLE_RATE,
          });
        } catch (err) {
          console.warn('Export audio: mixdown failed, exporting video only:', err);
          mixedAudioBuffer = null;
        }
      }
      setAudioStatus(mixedAudioBuffer ? 'mixed' : 'silent');
 
      if (abortRef.current) {
        setIsExporting(false);
        return;
      }
 
      // 2. Set up the muxer + WebCodecs encoder. Only configure an `audio`
      // track when there's actually a mixed buffer to encode — an empty
      // project or a browser without AudioEncoder support still produces a
      // valid (silent) MP4 rather than failing the whole export.
      muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: 'avc', width: encodeWidth, height: encodeHeight },
        ...(mixedAudioBuffer
          ? {
              audio: {
                codec: 'aac',
                numberOfChannels: mixedAudioBuffer.numberOfChannels,
                sampleRate: AUDIO_SAMPLE_RATE,
              },
            }
          : {}),
        fastStart: 'in-memory',
      });
 
      videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => {
          throw e;
        },
      });
      videoEncoder.configure({
        codec: 'avc1.640028',
        width: encodeWidth,
        height: encodeHeight,
        bitrate: bitrateMbps * 1_000_000,
        framerate: targetFps,
      });
 
      // 3. The actual deterministic frame loop — a pure function of frame
      // index, per the roadmap's Remotion-style contract. Cancellation is
      // checked once per frame (frame-by-frame processing makes this a
      // natural, cheap check rather than something bolted on afterward).
      for (let i = 0; i < totalFrames; i++) {
        if (abortRef.current) break;
 
        const time = exportStartTime + i / targetFps;
 
        // Seek every active video entity to this exact frame's local time
        // and await the browser actually landing the seek, before drawing
        // anything — this is what makes the frame deterministic instead of
        // "whatever happened to be decoded" at the moment we got to it.
        //
        // The seek target mirrors the live preview's math exactly: media
        // content time = mediaOffset + (t − clipStart) × (VideoRenderer.speed
        // × Transform.speed). Transform.speed here comes from the
        // keyframe/motion-script-resolved transform for THIS frame, so
        // sped-up (or keyframe-animated) clips export frame-accurately the
        // same way they preview. (This also folds in mediaOffset/comp.speed,
        // which the old seek ignored — preview always applied them, so this
        // closes a preview-vs-export drift rather than changing defaults.)
        const activeAtFrame = computeActiveEntitiesAtTime({
          entities: clips,
          tracks,
          scripts,
          time,
          fps: targetFps,
        });
        await Promise.all(
          activeAtFrame.map(({ entity, transform }) => {
            const isVideo = entity.type === 'video' || entity.components.some((c) => c.type === 'VideoRenderer');
            if (!isVideo) return Promise.resolve();
            const videoComp = entity.components.find((c) => c.type === 'VideoRenderer') || { src: entity.src };
            const src = videoComp.src || entity.src;
            if (!src) return Promise.resolve();
            const effRate = (videoComp.speed || 1) * (transform?.speed ?? 1);
            const localTime =
              (time - entity.startTime) * effRate + (videoComp.mediaOffset || 0);
            return videoFrameProvider.seekTo(entity.id, src, videoComp, localTime, effRate);
          })
        );
 
        if (abortRef.current) break;
 
        drawExportFrame({
          ctx,
          width: encodeWidth,
          height: encodeHeight,
          time,
          entities: clips,
          tracks,
          scripts,
          fps: targetFps,
          canvasContainers,
          videoFrameProvider,
        });
 
        const frameTimestampUs = Math.round((i / targetFps) * 1_000_000);
        const frameDurationUs = Math.round(1_000_000 / targetFps);
        const videoFrame = new VideoFrame(renderCanvas, {
          timestamp: frameTimestampUs,
          duration: frameDurationUs,
        });
        // Keyframe roughly every 2 seconds — arbitrary-render-speed
        // friendly (not tied to any real-time cadence) while keeping seek
        // performance reasonable in the output file.
        videoEncoder.encode(videoFrame, { keyFrame: i % (targetFps * 2) === 0 });
        videoFrame.close();
 
        // Let the encoder breathe rather than queuing every frame
        // instantly — avoids unbounded internal encoder queue growth on
        // long exports without slowing the loop down to real-time.
        if (videoEncoder.encodeQueueSize > 4) {
          await new Promise((resolve) => {
            const check = () => {
              if (videoEncoder.encodeQueueSize <= 2) resolve();
              else requestAnimationFrame(check);
            };
            check();
          });
        }
 
        setCurrentSec(time);
        const rawPct = Math.min(99, Math.round(((i + 1) / totalFrames) * 100));
        setProgress(isFfmpegEngine ? Math.round(rawPct * 0.6) : rawPct);
 
        // Cheap live-progress preview — draws the same canvas already
        // rendered above, not a second render pass.
        const previewCanvas = previewCanvasRef.current;
        if (previewCanvas) {
          const pctx = previewCanvas.getContext('2d');
          if (pctx) {
            previewCanvas.width = renderCanvas.width;
            previewCanvas.height = renderCanvas.height;
            pctx.drawImage(renderCanvas, 0, 0);
          }
        }
      }
 
      if (abortRef.current) {
        videoEncoder.close();
        return;
      }
 
      await videoEncoder.flush();
      videoEncoder.close();
 
      // 4. Encode the mixed-down audio (if any) into the same muxer, after
      // the video track is fully flushed. Order relative to the muxer
      // doesn't matter — mp4-muxer buffers both tracks and interleaves them
      // at finalize() — but doing it after the (usually much longer) video
      // loop keeps the progress bar meaningfully tied to video frames
      // throughout, with a short distinct "muxing audio" tail rather than
      // splitting the bar's meaning across two interleaved phases.
      if (mixedAudioBuffer) {
        setAudioStatus('encoding');
        try {
          await encodeAudioTrack({
            audioBuffer: mixedAudioBuffer,
            muxer,
            sampleRate: AUDIO_SAMPLE_RATE,
          });
        } catch (err) {
          // Audio encode failing at this late stage would otherwise throw
          // away an already-complete video render — fall back to muxing
          // video-only instead of losing the whole export.
          console.warn('Export audio: encode failed, finalizing video-only:', err);
          setAudioStatus('silent');
        }
      }
 
      muxer.finalize();
 
      const { buffer } = muxer.target;
      const blob = new Blob([buffer], { type: 'video/mp4' });

      if (isTauri() && savePath) {
        const { writeFile, remove } = await import('@tauri-apps/plugin-fs');
        if (isFfmpegEngine && tempIntermediatePath) {
          setExportPhase('ffmpeg');
          await writeFile(tempIntermediatePath, new Uint8Array(buffer));

          await executeFfmpegExport({
            inputPath: tempIntermediatePath,
            outputPath: savePath,
            format: ffmpegFormat,
            quality: ffmpegQuality,
            fps: targetFps,
            width: encodeWidth,
            height: encodeHeight,
            totalDurationSec: exportDuration,
            onProgress: ({ percent, frame, speed }) => {
              const overall = Math.min(99, 60 + Math.round(percent * 0.39));
              setProgress(overall);
              setFfmpegProgressDetail({ frame, speed });
            },
          });

          try {
            await remove(tempIntermediatePath);
          } catch (cleanErr) {
            console.warn('Could not clean up intermediate export file:', cleanErr);
          }
          setSavedFilePath(savePath);
        } else {
          // Native save: write the bytes straight to the path the user
          // picked in the dialog, then surface it with a "Show in Explorer"
          // action instead of the browser download anchor.
          await writeFile(savePath, new Uint8Array(buffer));
          setSavedFilePath(savePath);
        }
      } else {
        const url = URL.createObjectURL(blob);
        setDownloadUrl(url);
      }
      setProgress(100);
    } catch (err) {
      console.error('Export error:', err);
      setErrorMessage(`Export failed: ${err.message || err}`);
      try {
        videoEncoder?.close();
      } catch {
        // already closed
      }
    } finally {
      if (tempIntermediatePath) {
        try {
          const { exists, remove } = await import('@tauri-apps/plugin-fs');
          if (await exists(tempIntermediatePath)) {
            await remove(tempIntermediatePath);
          }
        } catch {
          // ignore cleanup errors
        }
      }
      videoFrameProvider.disposeAll();
      canvasContainers.disposeAll();
      setIsExporting(false);
      setExportPhase('rendering');
    }
  };
 
  return (
    <div className="modal-backdrop" onClick={isExporting ? null : onClose}>
      <div className="modal-card export-hub-modal" onClick={(e) => e.stopPropagation()}>
        {/* Top Header */}
        <div className="modal-header export-header">
          <div className="modal-title-group">
            <div className="export-icon-badge">
              <Film size={16} />
            </div>
            <div>
              <h3>Render Video</h3>
              <span className="export-header-sub">Deterministic Frame-by-Frame MP4 Export • {projectName}</span>
            </div>
          </div>
          {!isExporting && (
            <button className="close-btn" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>
 
        <div className="modal-body export-body">
          {errorMessage && (
            <div className="json-error-banner">
              <AlertCircle size={14} />
              <span>{errorMessage}</span>
            </div>
          )}
 
          {/* STATE 1: COMPLETED */}
          {downloadUrl ? (
            <div className="export-completed-card">
              <div className="completed-glow-icon">
                <CheckCircle2 size={52} className="text-emerald" />
              </div>
              <h3>Render Complete!</h3>
              <p className="completed-desc">
                Your composition's video, shapes, typography, and motion-script layers were rendered frame-by-frame into a single file at <strong>{encodeWidth}×{encodeHeight} ({preset === 'project' ? 'Project Res' : preset.toUpperCase()})</strong>.
              </p>
 
              <div className="rendered-summary-tags">
                <span className="tag-pill"><Clock size={12} /> {hasRange ? `${formatTimecode(exportStartTime)} → ${formatTimecode(exportEndTime)}` : formatTimecode(totalDuration)}</span>
                <span className="tag-pill"><Volume2 size={12} /> {audioStatus === 'silent' ? 'Silent' : 'Audio Mixed (AAC)'}</span>
                <span className="tag-pill"><HardDrive size={12} /> ~{estSizeMB} MB</span>
                <span className="tag-pill"><Tv size={12} /> {format.toUpperCase()}</span>
              </div>
 
              {/* Web: the usual blob download anchor. */}
              {downloadUrl && (
                <div className="completed-actions">
                  <a
                    href={downloadUrl}
                    download={`${projectName || 'blahblah-video'}.${format}`}
                    className="unity-btn unity-btn-primary download-hero-btn"
                  >
                    <Download size={18} />
                    <span>Download Video ({format.toUpperCase()})</span>
                  </a>

                  <button
                    className="unity-btn unity-btn-secondary"
                    onClick={() => {
                      setDownloadUrl(null);
                      setProgress(0);
                    }}
                  >
                    Render Another Preset
                  </button>
                </div>
              )}

              {/* Tauri: the file was saved natively — show where, and
                  offer to reveal it (highlighted) in Explorer. */}
              {isTauri() && savedFilePath && (
                <>
                  <p className="export-saved-path" title={savedFilePath}>
                    <HardDrive size={13} />
                    <span>{savedFilePath}</span>
                  </p>
                  <div className="completed-actions">
                    <button
                      className="unity-btn unity-btn-primary download-hero-btn"
                      onClick={handleRevealSavedFile}
                    >
                      <FolderOpen size={18} />
                      <span>Show in Explorer</span>
                    </button>

                    <button
                      className="unity-btn unity-btn-secondary"
                      onClick={() => {
                        setDownloadUrl(null);
                        setSavedFilePath(null);
                        setProgress(0);
                      }}
                    >
                      Render Another Preset
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : isExporting ? (
            /* STATE 2: FRAME-BY-FRAME RENDERING MONITOR */
            <div className="export-rendering-card">
              <div className="export-live-monitor-frame">
                <canvas ref={previewCanvasRef} className="export-live-canvas" />
              </div>
 
              <div className="render-meta-row">
                <span className="render-status-sub">
                  {audioStatus === 'mixing'
                    ? 'Mixing audio…'
                    : exportPhase === 'ffmpeg'
                    ? `FFmpeg encoding (${selectedFfmpegFormat.label}) ${ffmpegProgressDetail?.frame ? `— frame ${ffmpegProgressDetail.frame}` : ''} ${ffmpegProgressDetail?.speed ? `(${ffmpegProgressDetail.speed})` : ''} — ${progress}%`
                    : `Rendering frame ${Math.min(totalFrames, Math.round(currentSec * targetFps) + 1)} / ${totalFrames} (${formatTimecode(currentSec)} / ${formatTimecode(exportDuration)}) — ${progress}%`}
                </span>
              </div>
 
              <div className="render-bar-track">
                <div
                  className="render-bar-progress"
                  style={{ width: `${progress}%` }}
                />
              </div>
 
              <p className="render-caption">
                {audioStatus === 'mixing'
                  ? 'Decoding and mixing every audio-bearing clip in the export range down to one track before rendering video frames.'
                  : exportPhase === 'ffmpeg'
                  ? `Running FFmpeg sidecar to master and encode ${selectedFfmpegFormat.label} with ${FFMPEG_QUALITY_PRESETS[ffmpegQuality]?.label || ''}.`
                  : audioStatus === 'encoding'
                  ? 'Video render complete — encoding the mixed audio track to AAC and finalizing the MP4.'
                  : "Rendering each frame as a deterministic snapshot (not live playback) and encoding it into MP4 as it goes — render speed isn't tied to video duration."}
              </p>
 
              <button
                className="unity-btn unity-btn-danger-text"
                onClick={handleCancelExport}
              >
                Cancel Render
              </button>
            </div>
          ) : (
            /* STATE 3: SETTINGS 2-COLUMN HUB */
            <div className="export-hub-grid">
              {/* Left Column: Preset & Settings */}
              <div className="export-controls-col">
                {/* Resolution Preset Cards */}
                <div className="export-section">
                  <label className="section-label">Resolution Preset</label>
                  <div className="preset-cards-row">
                    {hasProjectRes && (
                      <div
                        className={`preset-card ${preset === 'project' ? 'active' : ''}`}
                        onClick={() => setPreset('project')}
                      >
                        <div className="preset-tag popular">Project</div>
                        <span className="preset-name">Project Resolution</span>
                        <span className="preset-res">{resolution.width} × {resolution.height}</span>
                      </div>
                    )}
 
                    <div
                      className={`preset-card ${preset === '720p' ? 'active' : ''}`}
                      onClick={() => setPreset('720p')}
                    >
                      <div className="preset-tag">Fast</div>
                      <span className="preset-name">720p HD</span>
                      <span className="preset-res">1280 × 720</span>
                    </div>
 
                    <div
                      className={`preset-card ${preset === '1080p' ? 'active' : ''}`}
                      onClick={() => setPreset('1080p')}
                    >
                      <div className="preset-tag popular">Standard</div>
                      <span className="preset-name">1080p Full HD</span>
                      <span className="preset-res">1920 × 1080</span>
                    </div>
 
                    <div
                      className={`preset-card ${preset === '4k' ? 'active' : ''}`}
                      onClick={() => setPreset('4k')}
                    >
                      <div className="preset-tag ultra">Ultra</div>
                      <span className="preset-name">4K Master</span>
                      <span className="preset-res">3840 × 2160</span>
                    </div>
                  </div>
                </div>
 
                {/* Export Engine Selection */}
                <div className="export-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="section-label">Export Engine</label>
                    {!isTauri() ? (
                      <span style={{ fontSize: 10, color: 'var(--unity-text-dim)' }}>
                        Desktop only: FFmpeg sidecar
                      </span>
                    ) : !ffmpegAvailable ? (
                      <span style={{ fontSize: 10, color: '#f87171' }}>
                        FFmpeg sidecar not found
                      </span>
                    ) : null}
                  </div>
                  <div className="engine-cards-row">
                    <div
                      className={`preset-card ${engine === 'webcodecs' ? 'active' : ''}`}
                      onClick={() => setEngine('webcodecs')}
                    >
                      <div className="preset-tag popular">Built-in</div>
                      <span className="preset-name">WebCodecs</span>
                      <span className="preset-res">Direct MP4 (H.264)</span>
                    </div>

                    <div
                      className={`preset-card ${engine === 'ffmpeg' ? 'active' : ''} ${(!isTauri() || !ffmpegAvailable) ? 'disabled-card' : ''}`}
                      onClick={() => {
                        if (isTauri() && ffmpegAvailable) {
                          setEngine('ffmpeg');
                        }
                      }}
                      title={!isTauri() ? 'FFmpeg sidecar is available in Tauri desktop app' : !ffmpegAvailable ? 'FFmpeg binary not detected' : 'Master with FFmpeg Sidecar'}
                      style={(!isTauri() || !ffmpegAvailable) ? { opacity: 0.45, cursor: 'not-allowed' } : {}}
                    >
                      <div className="preset-tag ultra">Sidecar</div>
                      <span className="preset-name">FFmpeg Engine</span>
                      <span className="preset-res">CRF Master · ProRes · GIF · WebM</span>
                    </div>
                  </div>
                </div>

                {/* Framerate & Quality */}
                <div className="export-params-row">
                  {isFfmpegEngine ? (
                    <>
                      <div className="param-field">
                        <label className="param-label">Format / Codec</label>
                        <select
                          className="unity-select"
                          value={ffmpegFormat}
                          onChange={(e) => setFfmpegFormat(e.target.value)}
                        >
                          {Object.entries(FFMPEG_FORMATS).map(([key, f]) => (
                            <option key={key} value={key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="param-field">
                        <label className="param-label">Framerate</label>
                        <select
                          className="unity-select"
                          value={fps}
                          onChange={(e) => setFps(e.target.value)}
                        >
                          <option value="24">24 FPS (Cinematic)</option>
                          <option value="30">30 FPS (Standard)</option>
                          <option value="60">60 FPS (Smooth 60fps)</option>
                        </select>
                      </div>

                      <div className="param-field">
                        <label className="param-label">Quality Preset</label>
                        <select
                          className="unity-select"
                          value={ffmpegQuality}
                          onChange={(e) => setFfmpegQuality(e.target.value)}
                        >
                          {Object.entries(FFMPEG_QUALITY_PRESETS).map(([key, q]) => (
                            <option key={key} value={key}>
                              {q.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="param-field">
                        <label className="param-label">Format</label>
                        <select className="unity-select" value={format} disabled>
                          <option value="mp4">MP4 Video (H.264)</option>
                        </select>
                      </div>

                      <div className="param-field">
                        <label className="param-label">Framerate</label>
                        <select
                          className="unity-select"
                          value={fps}
                          onChange={(e) => setFps(e.target.value)}
                        >
                          <option value="24">24 FPS (Cinematic)</option>
                          <option value="30">30 FPS (Standard)</option>
                          <option value="60">60 FPS (Smooth 60fps)</option>
                        </select>
                      </div>

                      <div className="param-field">
                        <label className="param-label">Quality</label>
                        <select
                          className="unity-select"
                          value={quality}
                          onChange={(e) => setQuality(e.target.value)}
                        >
                          <option value="standard">Standard Bitrate (4 Mbps)</option>
                          <option value="high">High Quality (8 Mbps)</option>
                          <option value="ultra">Ultra Fidelity (16 Mbps)</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>

                <button
                  className="unity-btn unity-btn-primary render-submit-btn"
                  onClick={handleStartExport}
                >
                  <Sparkles size={16} />
                  <span>
                    Start {isFfmpegEngine ? 'FFmpeg ' : ''}Export ({encodeWidth}×{encodeHeight} · {isFfmpegEngine ? selectedFfmpegFormat.extension.toUpperCase() : 'MP4'})
                  </span>
                </button>
              </div>

              {/* Right Column: Video Specs & Summary */}
              <div className="export-summary-col">
                <span className="summary-title">Composition Overview</span>

                <div className="summary-stat-grid">
                  <div className="stat-tile">
                    <span className="stat-tile-label"><Clock size={11} /> Duration</span>
                    <span className="stat-tile-val">{hasRange ? `${formatTimecode(exportStartTime)} → ${formatTimecode(exportEndTime)}` : formatTimecode(totalDuration)} ({totalFrames} frames)</span>
                  </div>

                  <div className="stat-tile">
                    <span className="stat-tile-label"><Tv size={11} /> Engine & Format</span>
                    <span className="stat-tile-val">
                      {isFfmpegEngine ? `FFmpeg · ${selectedFfmpegFormat.label}` : 'WebCodecs · MP4 (H.264)'}
                    </span>
                  </div>

                  <div className="stat-tile">
                    <span className="stat-tile-label"><Volume2 size={11} /> Audio</span>
                    <span className="stat-tile-val">
                      {isFfmpegEngine && selectedFfmpegFormat.noAudio
                        ? 'No Audio (GIF)'
                        : !audioSupported
                        ? 'Silent (unsupported browser)'
                        : hasAnyAudioSource
                        ? `${isFfmpegEngine && selectedFfmpegFormat.audioCodec ? selectedFfmpegFormat.audioCodec.toUpperCase() : 'AAC'}, will mix down`
                        : 'Silent (no audio clips)'}
                    </span>
                  </div>

                  <div className="stat-tile">
                    <span className="stat-tile-label"><Layers size={11} /> Layers</span>
                    <span className="stat-tile-val">{tracks.length} Tracks / {clips.length} Clips</span>
                  </div>

                  <div className="stat-tile">
                    <span className="stat-tile-label"><HardDrive size={11} /> Est. Size</span>
                    <span className="stat-tile-val">~{estSizeMB} MB</span>
                  </div>
                </div>

                <div className="summary-info-banner">
                  <Settings size={13} className="text-cyan" />
                  <span>
                    {isFfmpegEngine
                      ? `Deterministic Canvas rendering followed by FFmpeg Sidecar mastering to ${selectedFfmpegFormat.label} with ${FFMPEG_QUALITY_PRESETS[ffmpegQuality]?.label}.`
                      : 'Renders every frame as a deterministic snapshot of the exact composition — video, shapes, typography, and BlahTween/CanvasRenderer motion — then encodes it to H.264 MP4.'}
                    {isFfmpegEngine && selectedFfmpegFormat.noAudio
                      ? ' Audio track is omitted for animated GIF format.'
                      : audioSupported
                      ? ' Every AudioSource and audible VideoRenderer clip is mixed down and muxed in.'
                      : ' This browser lacks WebCodecs AudioEncoder support, so the export will be video-only.'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
 