import { useState, useRef } from 'react';
import { 
  Upload, 
  Film, 
  Music, 
  Type, 
  Plus, 
  Trash2, 
  FileVideo, 
  FileAudio,
  Sparkles
} from 'lucide-react';
import { formatTimecode, formatFileSize } from '../utils/timeFormat';
import { createSyntheticAudio, createSyntheticVideo } from '../utils/sampleMedia';

export function MediaLibrary({
  mediaAssets,
  onAddMediaAsset,
  onRemoveMediaAsset,
  onAddClipToTimeline,
}) {
  const [activeTab, setActiveTab] = useState('all');
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef(null);

  const handleFiles = (files) => {
    Array.from(files).forEach((file) => {
      const isVideo = file.type.startsWith('video/');
      const isAudio = file.type.startsWith('audio/');
      
      if (!isVideo && !isAudio) return;

      const url = URL.createObjectURL(file);
      const id = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

      if (isVideo) {
        const video = document.createElement('video');
        video.src = url;
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          onAddMediaAsset({
            id,
            name: file.name,
            type: 'video',
            url,
            duration: video.duration || 10,
            size: file.size,
            thumbnail: '🎬',
            width: video.videoWidth || 1920,
            height: video.videoHeight || 1080
          });
        };
      } else {
        const audio = document.createElement('audio');
        audio.src = url;
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => {
          onAddMediaAsset({
            id,
            name: file.name,
            type: 'audio',
            url,
            duration: audio.duration || 10,
            size: file.size,
            thumbnail: '🎵'
          });
        };
      }
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleGenerateSynthAudio = () => {
    setIsGenerating(true);
    setTimeout(() => {
      try {
        const url = createSyntheticAudio(10);
        onAddMediaAsset({
          id: `synth-aud-${Date.now()}`,
          name: 'Electronic Synth Beat (10s)',
          type: 'audio',
          url,
          duration: 10,
          size: 1764000,
          thumbnail: '🎹'
        });
      } finally {
        setIsGenerating(false);
      }
    }, 100);
  };

  const handleGenerateMotionVideo = async () => {
    setIsGenerating(true);
    try {
      const url = await createSyntheticVideo(6, 640, 360);
      onAddMediaAsset({
        id: `synth-vid-${Date.now()}`,
        name: 'Glowing Motion Graphic (6s)',
        type: 'video',
        url,
        duration: 6,
        size: 1200000,
        thumbnail: '✨',
        width: 640,
        height: 360
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddTextPreset = (presetType) => {
    const textPresets = {
      title: { text: 'Title Card', duration: 4, style: 'title' },
      subtitle: { text: 'Subtitle Text', duration: 3, style: 'subtitle' },
      lowerthird: { text: 'Lower Third Headline', duration: 5, style: 'lowerthird' },
    };
    const preset = textPresets[presetType] || textPresets.title;
    
    onAddClipToTimeline({
      type: 'text',
      name: preset.text,
      text: preset.text,
      duration: preset.duration,
      mediaOffset: 0,
      mediaDuration: preset.duration,
      volume: 1,
      speed: 1,
      color: '#f59e0b',
      textStyle: preset.style,
      fontSize: preset.style === 'title' ? 42 : preset.style === 'subtitle' ? 26 : 22,
      fontColor: '#ffffff',
      bgColor: preset.style === 'lowerthird' ? 'rgba(0,0,0,0.7)' : 'transparent',
    });
  };

  const filteredAssets = mediaAssets.filter(asset => {
    if (activeTab === 'video') return asset.type === 'video';
    if (activeTab === 'audio') return asset.type === 'audio';
    return true;
  });

  return (
    <aside className="media-library">
      <div className="panel-header">
        <h3 className="panel-title">Project Media</h3>
        <span className="count-badge">{mediaAssets.length}</span>
      </div>

      <div className="media-tabs">
        <button
          className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          All
        </button>
        <button
          className={`tab-btn ${activeTab === 'video' ? 'active' : ''}`}
          onClick={() => setActiveTab('video')}
        >
          <Film size={14} />
          <span>Videos</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'audio' ? 'active' : ''}`}
          onClick={() => setActiveTab('audio')}
        >
          <Music size={14} />
          <span>Audios</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`}
          onClick={() => setActiveTab('text')}
        >
          <Type size={14} />
          <span>Text</span>
        </button>
      </div>

      {activeTab === 'text' ? (
        <div className="text-presets-section">
          <p className="section-hint">Click preset to add text overlays on top video track:</p>
          <div className="preset-cards">
            <button className="preset-card" onClick={() => handleAddTextPreset('title')}>
              <div className="preset-preview title-preview">TITLE CARD</div>
              <div className="preset-info">
                <strong>Main Title</strong>
                <span>Large bold header</span>
              </div>
              <Plus size={16} />
            </button>

            <button className="preset-card" onClick={() => handleAddTextPreset('subtitle')}>
              <div className="preset-preview subtitle-preview">Subtitle Text</div>
              <div className="preset-info">
                <strong>Subtitle</strong>
                <span>Center bottom line</span>
              </div>
              <Plus size={16} />
            </button>

            <button className="preset-card" onClick={() => handleAddTextPreset('lowerthird')}>
              <div className="preset-preview lowerthird-preview">Headline Banner</div>
              <div className="preset-info">
                <strong>Lower Third</strong>
                <span>News / broadcast badge</span>
              </div>
              <Plus size={16} />
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Upload Drop Zone */}
          <div
            className={`drop-zone ${isDragging ? 'drag-over' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              multiple
              accept="video/*,audio/*"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <div className="drop-icon">
              <Upload size={22} />
            </div>
            <div className="drop-text">
              <strong>Click to upload</strong> or drag & drop
            </div>
            <span className="drop-subtext">Supports MP4, WebM, MOV, MP3, WAV, AAC</span>
          </div>

          {/* Quick Generators */}
          <div className="quick-generators">
            <button 
              className="quick-gen-btn" 
              onClick={handleGenerateSynthAudio}
              disabled={isGenerating}
              title="Procedurally generate a synth soundtrack"
            >
              <Sparkles size={13} />
              <span>+ Synth Audio</span>
            </button>
            <button 
              className="quick-gen-btn" 
              onClick={handleGenerateMotionVideo}
              disabled={isGenerating}
              title="Procedurally generate motion graphic video"
            >
              <Sparkles size={13} />
              <span>+ Motion Video</span>
            </button>
          </div>

          {/* Asset List */}
          <div className="media-list">
            {filteredAssets.length === 0 ? (
              <div className="empty-media">
                <p>No {activeTab === 'all' ? 'media' : activeTab} files yet.</p>
                <span>Upload your video/audio files or use quick demo generators above.</span>
              </div>
            ) : (
              filteredAssets.map((asset) => (
                <div key={asset.id} className="media-card">
                  <div className="media-thumb">
                    {asset.type === 'video' ? (
                      <div className="video-thumb-icon">
                        <FileVideo size={24} className="text-indigo" />
                      </div>
                    ) : (
                      <div className="audio-thumb-icon">
                        <FileAudio size={24} className="text-emerald" />
                      </div>
                    )}
                    <span className="duration-tag">{formatTimecode(asset.duration).slice(3)}</span>
                  </div>

                  <div className="media-details">
                    <span className="media-name" title={asset.name}>{asset.name}</span>
                    <div className="media-meta">
                      <span className="meta-type">{asset.type.toUpperCase()}</span>
                      <span className="meta-dot">•</span>
                      <span>{formatFileSize(asset.size)}</span>
                    </div>
                  </div>

                  <div className="media-actions">
                    <button
                      className="add-timeline-btn"
                      title="Add clip to timeline at playhead"
                      onClick={() => onAddClipToTimeline(asset)}
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      className="remove-asset-btn"
                      title="Delete asset"
                      onClick={() => onRemoveMediaAsset(asset.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </aside>
  );
}
