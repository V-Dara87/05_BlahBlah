import { useState, useRef } from 'react';
import { 
  Folder, 
  FolderOpen, 
  FileCode, 
  Package, 
  Film, 
  Music, 
  Upload, 
  Sparkles,
  Search
} from 'lucide-react';
import { formatTimecode } from '../utils/timeFormat';
import { createSyntheticAudio, createSyntheticVideo } from '../utils/sampleMedia';

export function ProjectBrowser({
  mediaAssets,
  prefabs,
  scripts,
  onAddMediaAsset,
  onCreateScript,
  onOpenScriptEditor,
  onInstantiatePrefabOnTimeline,
  onInstantiateMediaOnTimeline
}) {
  const [currentFolder, setCurrentFolder] = useState('All');
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
            size: file.size
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
            size: file.size
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
          size: 1764000
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
        size: 1200000
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateNewScript = () => {
    const newScript = {
      id: `script-${Date.now()}`,
      name: 'CustomMotion.cs',
      description: 'Custom C# MonoBehaviour script',
      code: `using UnityEngine;
using BlahTween;

public class CustomMotion : MonoBehaviour
{
    public float speed = 2.0f;
    public float amplitude = 30.0f;

    void Start()
    {
        transform.DOMoveY(-amplitude, 1.0f).SetEase(Ease.OutBounce).SetLoops(-1, LoopType.Yoyo);
    }

    void Update()
    {
        // Continuous rotation or math
        transform.rotation += Time.deltaTime * speed * 20.0f;
    }
}`
    };
    onCreateScript(newScript);
    onOpenScriptEditor(newScript);
  };

  return (
    <div className="unity-project-panel">
      {/* Project Window Header */}
      <div className="project-window-topbar">
        <div className="project-title-tabs">
          <span className="project-tab-title">Project</span>
          <span className="project-path-tag">Assets/{currentFolder !== 'All' ? currentFolder : ''}</span>
        </div>

        {/* Project Toolbar Actions */}
        <div className="project-actions-group">
          <button
            className="unity-btn unity-btn-secondary btn-sm"
            onClick={handleCreateNewScript}
            title="Create new C# MonoBehaviour Script"
          >
            <FileCode size={13} className="text-emerald" />
            <span>+ C# Script</span>
          </button>

          <button
            className="unity-btn unity-btn-secondary btn-sm"
            onClick={() => fileInputRef.current?.click()}
            title="Import Video or Audio Media"
          >
            <Upload size={13} />
            <span>Import Asset</span>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            multiple
            accept="video/*,audio/*"
            onChange={(e) => handleFileUpload(e.target.files)}
          />

          <div className="project-search-box">
            <Search size={12} className="search-icon" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Project Window 2-Column Split */}
      <div className="project-browser-body">
        {/* Left: Folder Hierarchy Tree */}
        <div className="folder-tree-column">
          <div
            className={`folder-tree-item ${currentFolder === 'All' ? 'active' : ''}`}
            onClick={() => setCurrentFolder('All')}
          >
            {currentFolder === 'All' ? <FolderOpen size={14} className="text-amber" /> : <Folder size={14} className="text-amber" />}
            <span>Assets (Root)</span>
          </div>

          <div
            className={`folder-tree-item sub ${currentFolder === 'Media' ? 'active' : ''}`}
            onClick={() => setCurrentFolder('Media')}
          >
            <Film size={13} className="text-indigo" />
            <span>Media ({mediaAssets.length})</span>
          </div>

          <div
            className={`folder-tree-item sub ${currentFolder === 'Prefabs' ? 'active' : ''}`}
            onClick={() => setCurrentFolder('Prefabs')}
          >
            <Package size={13} className="text-cyan" />
            <span>Prefabs ({prefabs.length})</span>
          </div>

          <div
            className={`folder-tree-item sub ${currentFolder === 'Scripts' ? 'active' : ''}`}
            onClick={() => setCurrentFolder('Scripts')}
          >
            <FileCode size={13} className="text-emerald" />
            <span>Scripts ({scripts.length})</span>
          </div>

          {/* Quick Procedural Generators */}
          <div className="procedural-assets-section">
            <span className="proc-label">Quick Generators</span>
            <button 
              className="proc-btn" 
              onClick={handleQuickSynthAudio}
              disabled={isGenerating}
            >
              <Sparkles size={11} />
              <span>+ Synth Audio</span>
            </button>
            <button 
              className="proc-btn" 
              onClick={handleQuickMotionVideo}
              disabled={isGenerating}
            >
              <Sparkles size={11} />
              <span>+ Motion Video</span>
            </button>
          </div>
        </div>

        {/* Right: Asset Grid Items */}
        <div className="asset-grid-column">
          {/* 1. Scripts */}
          {(currentFolder === 'All' || currentFolder === 'Scripts') && (
            <>
              {scripts
                .filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map(script => (
                  <div
                    key={script.id}
                    className="asset-grid-item script-item"
                    onDoubleClick={() => onOpenScriptEditor(script)}
                    title="Double-click to open in C# Code Editor"
                  >
                    <div className="asset-icon-box script-icon">
                      <FileCode size={26} />
                      <span className="cs-tag">C#</span>
                    </div>
                    <span className="asset-name">{script.name}</span>
                    <span className="asset-sub">MonoBehaviour</span>
                  </div>
                ))}
            </>
          )}

          {/* 2. Prefabs */}
          {(currentFolder === 'All' || currentFolder === 'Prefabs') && (
            <>
              {prefabs
                .filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map(prefab => (
                  <div
                    key={prefab.id}
                    className="asset-grid-item prefab-item"
                    onClick={() => onInstantiatePrefabOnTimeline(prefab)}
                    title="Click to place Prefab onto Timeline as GameObject"
                  >
                    <div className="asset-icon-box prefab-icon">
                      <Package size={26} />
                    </div>
                    <span className="asset-name">{prefab.name}</span>
                    <span className="asset-sub">Prefab (Click to Add)</span>
                  </div>
                ))}
            </>
          )}

          {/* 3. Media Assets */}
          {(currentFolder === 'All' || currentFolder === 'Media') && (
            <>
              {mediaAssets
                .filter(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map(asset => (
                  <div
                    key={asset.id}
                    className="asset-grid-item media-item"
                    onClick={() => onInstantiateMediaOnTimeline(asset)}
                    title="Click to place Media onto Timeline"
                  >
                    <div className={`asset-icon-box ${asset.type === 'video' ? 'video-icon' : 'audio-icon'}`}>
                      {asset.type === 'video' ? <Film size={26} /> : <Music size={26} />}
                      <span className="asset-dur-tag">{formatTimecode(asset.duration).slice(3)}</span>
                    </div>
                    <span className="asset-name">{asset.name}</span>
                    <span className="asset-sub">{asset.type.toUpperCase()}</span>
                  </div>
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
