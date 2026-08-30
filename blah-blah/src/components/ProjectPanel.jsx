import { useState, useRef, memo } from 'react';
import { 
  Package, 
  Film, 
  Music, 
  FileCode, 
  Plus, 
  Upload, 
  Trash2, 
  Sparkles,
  Search
} from 'lucide-react';
import { formatTimecode } from '../utils/timeFormat';
import { createSyntheticAudio, createSyntheticVideo } from '../utils/sampleMedia';
 
export const ProjectPanel = memo(function ProjectPanel({
  mediaAssets,
  prefabs,
  scripts,
  onAddMediaAsset,
  onRemoveMediaAsset,
  onRemovePrefab,
  onCreateScript,
  onOpenScriptEditor,
  onAddPrefabToTimeline,
  onAddMediaToTimeline,
}) {
  const [activeTab, setActiveTab] = useState('prefabs'); // 'prefabs' | 'media' | 'scripts'
  const [searchQuery, setSearchQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef(null);
 
  const handleFileUpload = (files) => {
    Array.from(files).forEach((file) => {
      const isVideo = file.type.startsWith('video/');
      const isAudio = file.type.startsWith('audio/');
      if (!isVideo && !isAudio) return;
 
      const url = URL.createObjectURL(file);
      const id = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
 
      if (isVideo) {
        const video = document.createElement('video');
        video.src = url;
        video.onloadedmetadata = () => {
          onAddMediaAsset({
            id,
            name: file.name,
            type: 'video',
            url,
            duration: video.duration || 8,
            size: file.size,
          });
        };
      } else {
        const audio = document.createElement('audio');
        audio.src = url;
        audio.onloadedmetadata = () => {
          onAddMediaAsset({
            id,
            name: file.name,
            type: 'audio',
            url,
            duration: audio.duration || 10,
            size: file.size,
          });
        };
      }
    });
  };
 
  const handleQuickSynthAudio = () => {
    setIsGenerating(true);
    setTimeout(() => {
      try {
        const url = createSyntheticAudio(10);
        onAddMediaAsset({
          id: `synth-aud-${Date.now()}`,
          name: 'Electronic Synth.wav',
          type: 'audio',
          url,
          duration: 10,
          size: 1764000,
        });
      } finally {
        setIsGenerating(false);
      }
    }, 100);
  };
 
  const handleQuickMotionVideo = async () => {
    setIsGenerating(true);
    try {
      const url = await createSyntheticVideo(6, 640, 360);
      onAddMediaAsset({
        id: `synth-vid-${Date.now()}`,
        name: 'Glowing Motion.mp4',
        type: 'video',
        url,
        duration: 6,
        size: 1200000,
      });
    } finally {
      setIsGenerating(false);
    }
  };
 
  const handleCreateNewMotionScript = () => {
    const newScript = {
      id: `script-${Date.now()}`,
      name: 'CustomMotion.js',
      description: 'Custom JavaScript Motion script',
      code: `export default class CustomMotion {
  static props = {
    speed: { type: 'number', default: 2.0, min: 0.1, max: 10, step: 0.1 },
    amplitude: { type: 'number', default: 30.0, min: 0, max: 200, step: 1 },
  };
 
  onStart({ transform, tween, props }) {
    tween.to(transform.position, { y: -props.amplitude }, {
      duration: 1.0,
      ease: 'outBounce',
      loop: 'yoyo'
    });
  }
 
  onUpdate({ transform, time, props }) {
    transform.rotation += (1 / 60) * props.speed * 30.0;
  }
}`
    };
    onCreateScript(newScript);
    onOpenScriptEditor(newScript);
  };
 
  const handleCreateNewReactClip = () => {
    const newScript = {
      id: `script-${Date.now()}`,
      name: 'CustomClip.jsx',
      description: 'Custom React Clip Component',
      code: `// Plain JavaScript, no JSX: use h(tag, props, children) which is a
// shorthand for React.createElement(tag, props, children). This runs
// directly in the browser with no build step, so JSX angle-bracket
// syntax (<div>...</div>) is not supported here - h(...) is the
// JSX-free equivalent.
export default function CustomClip({
  title = "MY REACT CLIP",
  color = "#38bdf8"
}) {
  return h('div', {
    style: {
      padding: '20px 32px',
      background: 'rgba(15, 23, 42, 0.85)',
      borderRadius: '16px',
      border: '1px solid ' + color,
      boxShadow: '0 8px 32px ' + color + '33',
      color: '#ffffff',
      fontFamily: 'Inter, sans-serif',
      fontSize: '22px',
      fontWeight: 'bold',
      textAlign: 'center'
    }
  }, title);
}
 
CustomClip.props = {
  title: { type: 'string', default: 'MY REACT CLIP' },
  color: { type: 'color', default: '#38bdf8' }
};`
    };
    onCreateScript(newScript);
    onOpenScriptEditor(newScript);
  };
 
  // Drag-and-drop support
  const handleDragStart = (e, itemType, itemData) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ itemType, itemData }));
    e.dataTransfer.effectAllowed = 'copy';
  };
 
  return (
    <aside className="project-panel">
      {/* Panel Header */}
      <div className="panel-top-header">
        <h3 className="panel-title-text">Project Assets</h3>
        <div className="search-bar-sm">
          <Search size={11} className="search-icon" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
 
      {/* Tabs */}
      <div className="project-tab-bar">
        <button
          className={`tab-btn-pill ${activeTab === 'prefabs' ? 'active' : ''}`}
          onClick={() => setActiveTab('prefabs')}
        >
          <Package size={13} />
          <span>Prefabs</span>
        </button>
        <button
          className={`tab-btn-pill ${activeTab === 'media' ? 'active' : ''}`}
          onClick={() => setActiveTab('media')}
        >
          <Film size={13} />
          <span>Media</span>
        </button>
        <button
          className={`tab-btn-pill ${activeTab === 'scripts' ? 'active' : ''}`}
          onClick={() => setActiveTab('scripts')}
        >
          <FileCode size={13} />
          <span>Scripts / JSX</span>
        </button>
      </div>
 
      {/* Tab Actions */}
      <div className="project-actions-row">
        {activeTab === 'media' && (
          <>
            <button
              className="action-btn-sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={12} />
              <span>Import Media</span>
            </button>
            <button
              className="action-btn-sm text-cyan"
              onClick={handleQuickSynthAudio}
              disabled={isGenerating}
            >
              <Sparkles size={11} />
              <span>+ Synth</span>
            </button>
            <button
              className="action-btn-sm text-cyan"
              onClick={handleQuickMotionVideo}
              disabled={isGenerating}
            >
              <Sparkles size={11} />
              <span>+ Video</span>
            </button>
          </>
        )}
 
        {activeTab === 'scripts' && (
          <div className="script-add-row" style={{ display: 'flex', gap: '6px', width: '100%' }}>
            <button
              className="action-btn-sm"
              style={{ flex: 1 }}
              onClick={handleCreateNewMotionScript}
            >
              <FileCode size={12} className="text-emerald" />
              <span>+ Motion Script</span>
            </button>
            <button
              className="action-btn-sm text-cyan"
              style={{ flex: 1 }}
              onClick={handleCreateNewReactClip}
            >
              <Sparkles size={12} />
              <span>+ React Clip</span>
            </button>
          </div>
        )}
 
        {activeTab === 'prefabs' && (
          <p className="tab-helper-text">
            Drag a Prefab or click <strong>+</strong> to place onto the timeline:
          </p>
        )}
 
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          multiple
          accept="video/*,audio/*"
          onChange={(e) => handleFileUpload(e.target.files)}
        />
      </div>
 
      {/* Asset List Content */}
      <div className="project-asset-list">
        {/* PREFABS TAB */}
        {activeTab === 'prefabs' && (
          <>
            {prefabs
              .filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((prefab) => (
                <div
                  key={prefab.id}
                  className="asset-card prefab-card"
                  draggable
                  onDragStart={(e) => handleDragStart(e, 'prefab', prefab)}
                >
                  <div className="asset-icon-box text-cyan">
                    <Package size={20} />
                  </div>
                  <div className="asset-info-box">
                    <span className="asset-title-main">{prefab.name}</span>
                    <span className="asset-subtitle">Prefab GameObject</span>
                  </div>
                  <div className="asset-card-btns">
                    <button
                      className="card-action-btn add-btn"
                      title="Add to timeline"
                      onClick={() => onAddPrefabToTimeline(prefab)}
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      className="card-action-btn del-btn"
                      title="Delete prefab"
                      onClick={() => onRemovePrefab(prefab.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
          </>
        )}
 
        {/* MEDIA TAB */}
        {activeTab === 'media' && (
          <>
            {mediaAssets
              .filter((m) => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((asset) => (
                <div
                  key={asset.id}
                  className="asset-card media-card"
                  draggable
                  onDragStart={(e) => handleDragStart(e, 'media', asset)}
                >
                  <div className={`asset-icon-box ${asset.type === 'video' ? 'text-indigo' : 'text-emerald'}`}>
                    {asset.type === 'video' ? <Film size={20} /> : <Music size={20} />}
                    <span className="duration-tag">{formatTimecode(asset.duration).slice(3)}</span>
                  </div>
                  <div className="asset-info-box">
                    <span className="asset-title-main">{asset.name}</span>
                    <span className="asset-subtitle">{asset.type.toUpperCase()}</span>
                  </div>
                  <div className="asset-card-btns">
                    <button
                      className="card-action-btn add-btn"
                      title="Add to timeline"
                      onClick={() => onAddMediaToTimeline(asset)}
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      className="card-action-btn del-btn"
                      title="Delete asset"
                      onClick={() => onRemoveMediaAsset(asset.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
          </>
        )}
 
        {/* SCRIPTS TAB */}
        {activeTab === 'scripts' && (
          <>
            {scripts
              .filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((script) => {
                const isJsx = script.name.endsWith('.jsx') || script.code?.includes('return');
                return (
                  <div
                    key={script.id}
                    className="asset-card script-card"
                    onClick={() => onOpenScriptEditor(script)}
                    draggable
                    onDragStart={(e) => handleDragStart(e, 'script', script)}
                  >
                    <div className={`asset-icon-box ${isJsx ? 'text-cyan' : 'text-emerald'}`}>
                      {isJsx ? <Sparkles size={20} /> : <FileCode size={20} />}
                    </div>
                    <div className="asset-info-box">
                      <span className="asset-title-main">{script.name}</span>
                      <span className="asset-subtitle">{isJsx ? 'React JSX Clip' : 'Motion Script'}</span>
                    </div>
                  </div>
                );
              })}
          </>
        )}
      </div>
    </aside>
  );
});
 