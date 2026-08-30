import { useState, useRef } from 'react';
import { 
  Download, 
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
  Volume2
} from 'lucide-react';
import { formatTimecode } from '../utils/timeFormat';
import { executeScriptComponent } from '../engine/scriptRunner';

export function ExportModal({
  isOpen,
  onClose,
  projectName,
  clips,
  tracks,
  scripts = [],
  totalDuration,
}) {
  const [preset, setPreset] = useState('1080p'); // '720p' | '1080p' | '4k'
  const [format, setFormat] = useState('mp4'); // 'mp4' | 'webm'
  const [fps, setFps] = useState('30');
  const [quality, setQuality] = useState('high');

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const canvasRef = useRef(null);
  const abortRef = useRef(false);

  if (!isOpen) return null;

  const targetFps = parseInt(fps) || 30;
  const exportDuration = Math.max(1, Math.min(180, totalDuration));

  const width = preset === '4k' ? 3840 : preset === '1080p' ? 1920 : 1280;
  const height = preset === '4k' ? 2160 : preset === '1080p' ? 1080 : 720;
  const scaleFactor = height / 720;

  const bitrateMbps = quality === 'ultra' ? 16 : quality === 'high' ? 8 : 4;
  const estSizeBytes = (bitrateMbps * 1000000 / 8) * exportDuration;
  const estSizeMB = (estSizeBytes / (1024 * 1024)).toFixed(1);

  const handleCancelExport = () => {
    abortRef.current = true;
    setIsExporting(false);
    setProgress(0);
  };

  const handleStartExport = async () => {
    setIsExporting(true);
    setProgress(0);
    setCurrentSec(0);
    setDownloadUrl(null);
    setErrorMessage(null);
    abortRef.current = false;

    let audioContext = null;
    const mediaElements = [];

    try {
      // 1. Setup AudioContext and Stream Destination for audio mixing
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      const audioDestination = audioContext.createMediaStreamDestination();

      // 2. Prepare Canvas
      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });

      // 3. Preload all Video and Audio clips
      const videoClips = clips.filter(
        c => c.type === 'video' || c.components?.some(comp => comp.type === 'VideoRenderer')
      );
      const audioClips = clips.filter(
        c => c.type === 'audio' || c.components?.some(comp => comp.type === 'AudioSource')
      );

      const loadedVideos = {};
      const loadedAudios = {};

      // Load Videos
      await Promise.all(
        videoClips.map(c => {
          return new Promise(resolve => {
            const videoComp = c.components?.find(comp => comp.type === 'VideoRenderer');
            const src = videoComp?.src || c.src;
            if (!src) return resolve();

            const v = document.createElement('video');
            v.crossOrigin = 'anonymous';
            v.src = src;
            v.playsInline = true;
            v.preload = 'auto';

            const onReady = () => {
              loadedVideos[c.id] = v;
              mediaElements.push(v);
              // Connect video audio to mixer if has audio
              try {
                const sourceNode = audioContext.createMediaElementSource(v);
                const gainNode = audioContext.createGain();
                gainNode.gain.value = videoComp?.volume ?? 1;
                sourceNode.connect(gainNode);
                gainNode.connect(audioDestination);
              } catch {
                // Video might be silent
              }
              resolve();
            };

            if (v.readyState >= 2) {
              onReady();
            } else {
              v.onloadeddata = onReady;
              v.onerror = () => resolve();
              setTimeout(resolve, 2000);
            }
          });
        })
      );

      // Load Audios & schedule Web Audio playback
      await Promise.all(
        audioClips.map(c => {
          return new Promise(resolve => {
            const audioComp = c.components?.find(comp => comp.type === 'AudioSource');
            const src = audioComp?.src || c.src;
            if (!src) return resolve();

            const a = new Audio();
            a.crossOrigin = 'anonymous';
            a.src = src;
            a.preload = 'auto';

            const onReady = () => {
              loadedAudios[c.id] = a;
              mediaElements.push(a);
              try {
                const sourceNode = audioContext.createMediaElementSource(a);
                const gainNode = audioContext.createGain();
                gainNode.gain.value = audioComp?.volume ?? 1;
                sourceNode.connect(gainNode);
                gainNode.connect(audioDestination);
              } catch {
                // Audio connect fallback
              }
              resolve();
            };

            if (a.readyState >= 2) {
              onReady();
            } else {
              a.onloadeddata = onReady;
              a.onerror = () => resolve();
              setTimeout(resolve, 2000);
            }
          });
        })
      );

      // 4. Combine Video Canvas Stream + Mixed Audio Stream
      const canvasStream = canvas.captureStream(targetFps);
      const combinedTracks = [
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks()
      ];
      const combinedStream = new MediaStream(combinedTracks);

      // 5. Select Best Supported Container Format (MP4 with AAC or WebM with Opus)
      let selectedMimeType = 'video/webm; codecs=vp9,opus';
      if (format === 'mp4') {
        if (MediaRecorder.isTypeSupported('video/mp4; codecs=avc1,mp4a.40.2')) {
          selectedMimeType = 'video/mp4; codecs=avc1,mp4a.40.2';
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
          selectedMimeType = 'video/mp4';
        } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9,opus')) {
          selectedMimeType = 'video/webm; codecs=vp9,opus';
        } else {
          selectedMimeType = 'video/webm';
        }
      } else {
        if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9,opus')) {
          selectedMimeType = 'video/webm; codecs=vp9,opus';
        } else {
          selectedMimeType = 'video/webm';
        }
      }

      let mediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(combinedStream, {
          mimeType: selectedMimeType,
          videoBitsPerSecond: bitrateMbps * 1_000_000,
          audioBitsPerSecond: 192000
        });
      } catch {
        mediaRecorder = new MediaRecorder(combinedStream);
      }

      const recordedChunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
      };

      const recorderStopPromise = new Promise(resolve => {
        mediaRecorder.onstop = () => {
          const actualMime = selectedMimeType.includes('mp4') ? 'video/mp4' : 'video/webm';
          const blob = new Blob(recordedChunks, { type: actualMime });
          const url = URL.createObjectURL(blob);
          resolve(url);
        };
      });

      mediaRecorder.start(100);

      // 6. Synchronized Real-Time Composition Render Loop
      const startTime = performance.now();

      const renderTick = () => {
        if (abortRef.current) {
          mediaRecorder.stop();
          mediaElements.forEach(el => el.pause());
          if (audioContext) audioContext.close();
          return;
        }

        const elapsedSec = (performance.now() - startTime) / 1000;
        setCurrentSec(elapsedSec);
        const currentProgress = Math.min(99, Math.round((elapsedSec / exportDuration) * 100));
        setProgress(currentProgress);

        if (elapsedSec >= exportDuration) {
          // Finished rendering!
          mediaElements.forEach(el => el.pause());
          mediaRecorder.stop();
          recorderStopPromise.then(url => {
            setDownloadUrl(url);
            setProgress(100);
            setIsExporting(false);
            if (audioContext) audioContext.close();
          });
          return;
        }

        const currentTime = elapsedSec;

        // Clear canvas
        ctx.fillStyle = '#090a0f';
        ctx.fillRect(0, 0, width, height);

        // Filter active clips
        const activeClips = clips.filter(c => {
          if (c.active === false) return false;
          if (currentTime < c.startTime || currentTime >= c.startTime + c.duration) return false;
          const track = tracks.find(t => t.id === c.trackId);
          if (track && (!track.visible || track.locked)) return false;
          return true;
        });

        // Sync Audio elements playback
        audioClips.forEach(c => {
          const a = loadedAudios[c.id];
          if (!a) return;
          const isActive = currentTime >= c.startTime && currentTime < c.startTime + c.duration;
          if (isActive) {
            const audioComp = c.components?.find(comp => comp.type === 'AudioSource');
            const speed = audioComp?.speed || 1;
            const offset = audioComp?.mediaOffset || 0;
            const localTime = (currentTime - c.startTime) * speed + offset;

            if (Math.abs(a.currentTime - localTime) > 0.15) {
              a.currentTime = Math.max(0, localTime);
            }
            if (a.paused) a.play().catch(() => {});
          } else {
            if (!a.paused) a.pause();
          }
        });

        // Sort back tracks first (Track 4 to Track 1)
        const sortedClips = [...activeClips].sort((a, b) => {
          const trackA = tracks.findIndex(t => t.id === a.trackId);
          const trackB = tracks.findIndex(t => t.id === b.trackId);
          return trackB - trackA;
        });

        // Render each active clip onto the canvas
        for (const entity of sortedClips) {
          const localTime = currentTime - entity.startTime;
          let transform = entity.components?.find(c => c.type === 'Transform') || {
            x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1
          };

          // Execute JS/TS Motion script if attached
          const scriptComp = entity.components?.find(c => (c.type === 'ScriptComponent' || c.type === 'MonoBehaviour') && c.enabled);
          if (scriptComp) {
            const scriptDef = scripts.find(s => s.id === scriptComp.scriptId);
            if (scriptDef && scriptDef.code) {
              transform = executeScriptComponent({
                scriptCode: scriptDef.code,
                transform,
                localTime,
                clipDuration: entity.duration,
                publicValues: scriptComp.props || {},
                frame: Math.round(localTime * targetFps),
                fps: targetFps
              });
            }
          }

          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, transform.opacity ?? 1));

          // Draw 1: Video
          const isVideo = entity.type === 'video' || entity.components?.some(c => c.type === 'VideoRenderer');
          if (isVideo && loadedVideos[entity.id]) {
            const v = loadedVideos[entity.id];
            const videoComp = entity.components?.find(c => c.type === 'VideoRenderer');
            const speed = videoComp?.speed || 1;
            const offset = videoComp?.mediaOffset || 0;
            const vidLocalTime = localTime * speed + offset;

            if (Math.abs(v.currentTime - vidLocalTime) > 0.15) {
              v.currentTime = Math.max(0, vidLocalTime);
            }
            if (v.paused) v.play().catch(() => {});

            try {
              const posX = width / 2 + transform.x * scaleFactor;
              const posY = height / 2 + transform.y * scaleFactor;
              ctx.translate(posX, posY);
              ctx.rotate(((transform.rotation || 0) * Math.PI) / 180);
              ctx.scale(transform.scaleX ?? 1, transform.scaleY ?? 1);

              ctx.drawImage(v, -width / 2, -height / 2, width, height);
            } catch {
              const grad = ctx.createLinearGradient(0, 0, width, height);
              grad.addColorStop(0, '#1e1b4b');
              grad.addColorStop(1, '#0f172a');
              ctx.fillStyle = grad;
              ctx.fillRect(0, 0, width, height);
            }
          }

          // Draw 2: Shape
          const shapeComp = entity.components?.find(c => c.type === 'ShapeRenderer');
          if (shapeComp) {
            const posX = width / 2 + transform.x * scaleFactor;
            const posY = height / 2 + transform.y * scaleFactor;
            ctx.translate(posX, posY);
            ctx.rotate(((transform.rotation || 0) * Math.PI) / 180);
            ctx.scale(transform.scaleX ?? 1, transform.scaleY ?? 1);

            const sw = (shapeComp.width || 180) * scaleFactor;
            const sh = (shapeComp.height || 180) * scaleFactor;
            ctx.fillStyle = shapeComp.color || '#4f46e5';

            if (shapeComp.shapeType === 'circle') {
              ctx.beginPath();
              ctx.arc(0, 0, sw / 2, 0, Math.PI * 2);
              ctx.fill();
            } else {
              const rad = (shapeComp.borderRadius || 12) * scaleFactor;
              ctx.beginPath();
              ctx.roundRect(-sw / 2, -sh / 2, sw, sh, rad);
              ctx.fill();
            }

            if (shapeComp.strokeWidth) {
              ctx.strokeStyle = shapeComp.strokeColor || '#38bdf8';
              ctx.lineWidth = (shapeComp.strokeWidth || 2) * scaleFactor;
              ctx.stroke();
            }
          }

          // Draw 3: React Clip Component
          const reactComp = entity.components?.find(c => c.type === 'ReactRenderer');
          if (reactComp) {
            const posX = width / 2 + transform.x * scaleFactor;
            const posY = height / 2 + transform.y * scaleFactor;
            ctx.translate(posX, posY);
            ctx.rotate(((transform.rotation || 0) * Math.PI) / 180);
            ctx.scale(transform.scaleX ?? 1, transform.scaleY ?? 1);

            const cardW = 340 * scaleFactor;
            const cardH = 80 * scaleFactor;
            const cardRad = 20 * scaleFactor;
            const accent = reactComp.props?.accentColor || reactComp.props?.color || '#6366f1';

            // Background glass box
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.beginPath();
            ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, cardRad);
            ctx.fill();

            // Border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1.5 * scaleFactor;
            ctx.stroke();

            // Badge
            if (reactComp.props?.badge) {
              ctx.fillStyle = accent;
              ctx.beginPath();
              ctx.roundRect(-cardW / 2 + 16 * scaleFactor, -14 * scaleFactor, 100 * scaleFactor, 28 * scaleFactor, 14 * scaleFactor);
              ctx.fill();

              ctx.font = `800 ${Math.round(11 * scaleFactor)}px Inter, sans-serif`;
              ctx.fillStyle = '#ffffff';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(String(reactComp.props.badge), -cardW / 2 + 66 * scaleFactor, 0);
            }

            // Title
            const titleText = reactComp.props?.title || reactComp.props?.text || entity.name;
            ctx.font = `800 ${Math.round(20 * scaleFactor)}px Inter, sans-serif`;
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = reactComp.props?.badge ? 'left' : 'center';
            ctx.textBaseline = 'middle';
            const textX = reactComp.props?.badge ? (-cardW / 2 + 130 * scaleFactor) : 0;
            ctx.fillText(String(titleText), textX, 0);
          }

          // Draw 4: Text
          const textComp = entity.components?.find(c => c.type === 'TextRenderer');
          if (textComp) {
            const posX = width / 2 + transform.x * scaleFactor;
            const posY = height / 2 + transform.y * scaleFactor;
            ctx.translate(posX, posY);
            ctx.rotate(((transform.rotation || 0) * Math.PI) / 180);
            ctx.scale(transform.scaleX ?? 1, transform.scaleY ?? 1);

            const fontSize = Math.round((textComp.fontSize || 38) * scaleFactor);
            ctx.font = `800 ${fontSize}px ${textComp.fontFamily || 'Inter, sans-serif'}`;
            ctx.fillStyle = textComp.fontColor || '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            if (textComp.shadowColor) {
              ctx.shadowColor = textComp.shadowColor;
              ctx.shadowBlur = (textComp.shadowBlur || 14) * scaleFactor;
            } else {
              ctx.shadowColor = 'rgba(0,0,0,0.9)';
              ctx.shadowBlur = 12 * scaleFactor;
            }

            ctx.fillText(textComp.text || entity.name, 0, 0);
            ctx.shadowBlur = 0;
          }

          ctx.restore();
        }

        // Schedule next frame
        requestAnimationFrame(renderTick);
      };

      requestAnimationFrame(renderTick);
    } catch (err) {
      console.error('Export error:', err);
      setErrorMessage(`Export failed: ${err.message || err}`);
      setIsExporting(false);
      mediaElements.forEach(el => el.pause());
      if (audioContext) audioContext.close();
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
              <h3>Render Video with Audio</h3>
              <span className="export-header-sub">Multi-Track Video & Audio Compositor • {projectName}</span>
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
                Your edited composition with all video, audio, and motion layers was exported into a single file at <strong>{width}×{height} ({preset.toUpperCase()})</strong>.
              </p>

              <div className="rendered-summary-tags">
                <span className="tag-pill"><Clock size={12} /> {formatTimecode(totalDuration)}</span>
                <span className="tag-pill"><Volume2 size={12} /> Synced Audio</span>
                <span className="tag-pill"><HardDrive size={12} /> ~{estSizeMB} MB</span>
                <span className="tag-pill"><Tv size={12} /> {format.toUpperCase()}</span>
              </div>

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
            </div>
          ) : isExporting ? (
            /* STATE 2: LIVE RENDERING MONITOR */
            <div className="export-rendering-card">
              {/* Mini live rendering monitor canvas */}
              <div className="export-live-monitor-frame">
                <canvas ref={canvasRef} className="export-live-canvas" />
              </div>

              <div className="render-meta-row">
                <span className="render-status-sub">
                  Rendering: {formatTimecode(currentSec)} / {formatTimecode(exportDuration)} ({progress}%)
                </span>
              </div>

              <div className="render-bar-track">
                <div 
                  className="render-bar-progress"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <p className="render-caption">
                Compositing video frames, mixing multi-track audio, and rendering BlahTween animations into a single file...
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

                {/* Container & Framerate */}
                <div className="export-params-row">
                  <div className="param-field">
                    <label className="param-label">Format</label>
                    <select
                      className="unity-select"
                      value={format}
                      onChange={(e) => setFormat(e.target.value)}
                    >
                      <option value="mp4">MP4 Video</option>
                      <option value="webm">WebM Video</option>
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
                </div>

                <button
                  className="unity-btn unity-btn-primary render-submit-btn"
                  onClick={handleStartExport}
                >
                  <Sparkles size={16} />
                  <span>Start Export ({width}×{height})</span>
                </button>
              </div>

              {/* Right Column: Video Specs & Summary */}
              <div className="export-summary-col">
                <span className="summary-title">Composition Overview</span>

                <div className="summary-stat-grid">
                  <div className="stat-tile">
                    <span className="stat-tile-label"><Clock size={11} /> Duration</span>
                    <span className="stat-tile-val">{formatTimecode(totalDuration)}</span>
                  </div>

                  <div className="stat-tile">
                    <span className="stat-tile-label"><Volume2 size={11} /> Audio Tracks</span>
                    <span className="stat-tile-val">Mixed & Synced</span>
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
                  <span>Exports all video tracks, background audio, voiceover, shapes, typography, and C# BlahTween motion animations into one single playable video file.</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
