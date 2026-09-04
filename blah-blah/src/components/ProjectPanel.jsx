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
  Search,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { formatTimecode } from '../utils/timeFormat';
import { createSyntheticAudio, createSyntheticVideo } from '../utils/sampleMedia';
import { detectScriptKind } from '../engine/scriptRunner';
import { importMediaFiles } from '../services/mediaImport';

// Per-kind display metadata for script cards (see detectScriptKind).
const SCRIPT_KIND_META = {
  react: { icon: Sparkles, className: 'text-cyan', label: 'React Component' },
  canvas: { icon: Sparkles, className: 'text-violet', label: 'Canvas Component' },
  motion: { icon: FileCode, className: 'text-emerald', label: 'Motion Script' },
};
const scriptKindMeta = (kind) => SCRIPT_KIND_META[kind] || SCRIPT_KIND_META.motion;
 
/**
 * Project tab redesign — was three separate tabs (Prefabs / Media /
 * Scripts) each showing its own flat (or, for Media, one-level-folder)
 * list, switched between with a pill tab bar. Replaced with a single
 * folder tree matching the actual on-disk project layout
 * (`prefabs/`, `media/` incl. its subfolders, `scripts/`), all visible
 * and independently collapsible at once instead of hidden behind tabs.
 * `media/`'s existing subfolder grouping (e.g. "Recordings") is preserved
 * as a nested level under `media/` rather than its own top-level folder.
 *
 * Every action that existed before (import media, quick-synth buttons,
 * new script buttons, add-to-timeline, delete, drag-to-timeline, search,
 * click-to-edit-script) still works exactly the same — each top-level
 * folder just carries its own "+" popover for the actions that used to
 * live in the tab-specific action row, so they're reachable without a
 * persistent tab context.
 */
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
  const [searchQuery, setSearchQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [openFolders, setOpenFolders] = useState({
    prefabs: true,
    media: true,
    scripts: true,
  });
  const [openMediaSubfolders, setOpenMediaSubfolders] = useState({});
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const [scriptsMenuOpen, setScriptsMenuOpen] = useState(false);
  const fileInputRef = useRef(null);
 
  const toggleFolder = (name) => {
    setOpenFolders((prev) => ({ ...prev, [name]: !prev[name] }));
  };
 
  const toggleMediaSubfolder = (name) => {
    setOpenMediaSubfolders((prev) => ({ ...prev, [name]: !prev[name] }));
  };
 
  const handleFileUpload = (files) => {
    // Shared import helper (same probe + asset shape as OS file drops,
    // see services/mediaImport.js) so the picker and desktop drag&drop
    // stay in sync.
    importMediaFiles({ files, onAddMediaAsset });
  };
 
  const handleQuickSynthAudio = () => {
    setMediaMenuOpen(false);
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
    setMediaMenuOpen(false);
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
 
  const handleCreateNewScript = () => {
    setScriptsMenuOpen(false);
    const newScript = {
      id: `script-${Date.now()}`,
      name: 'NewScript.jsx',
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
 
  // Drag-and-drop support (unchanged)
  const handleDragStart = (e, itemType, itemData) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ itemType, itemData }));
    e.dataTransfer.effectAllowed = 'copy';
  };
 
  const query = searchQuery.toLowerCase();
  const filteredPrefabs = prefabs.filter((p) => p.name.toLowerCase().includes(query));
  const filteredMedia = mediaAssets.filter((m) => m.name.toLowerCase().includes(query));
  const filteredScripts = scripts.filter((s) => s.name.toLowerCase().includes(query));
 
  const rootMedia = filteredMedia.filter((m) => !m.folder);
  const mediaSubfolderNames = Array.from(new Set(filteredMedia.filter((m) => m.folder).map((m) => m.folder)));
 
  const renderMediaCard = (asset) => (
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
  );
 
  return (
    <aside className="project-panel">
      {/* Panel Header */}
      <div className="panel-top-header">
        <h3 className="panel-title-text">Project</h3>
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
 
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        multiple
        accept="video/*,audio/*"
        onChange={(e) => handleFileUpload(e.target.files)}
      />
 
      {/* Folder Tree */}
      <div className="project-tree">
 
        {/* ========== prefabs/ ========== */}
        <div className="tree-folder-group">
          <div className="tree-folder-header" onClick={() => toggleFolder('prefabs')}>
            {openFolders.prefabs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {openFolders.prefabs ? <FolderOpen size={13} className="text-cyan" /> : <Folder size={13} className="text-cyan" />}
            <span className="tree-folder-name">prefabs</span>
            <span className="tree-folder-count">{filteredPrefabs.length}</span>
          </div>
 
          {openFolders.prefabs && (
            <div className="tree-folder-contents">
              {filteredPrefabs.length === 0 && (
                <p className="tree-empty-hint">No prefabs yet. Save a GameObject as a Prefab from the Inspector.</p>
              )}
              {filteredPrefabs.map((prefab) => (
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
            </div>
          )}
        </div>
 
        {/* ========== media/ ========== */}
        <div className="tree-folder-group">
          <div className="tree-folder-header" onClick={() => toggleFolder('media')}>
            {openFolders.media ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {openFolders.media ? <FolderOpen size={13} className="text-indigo" /> : <Folder size={13} className="text-indigo" />}
            <span className="tree-folder-name">media</span>
            <span className="tree-folder-count">{filteredMedia.length}</span>
            <div className="tree-folder-add-wrapper">
              <button
                className="tree-folder-add-btn"
                title="Add media"
                onClick={(e) => { e.stopPropagation(); setMediaMenuOpen((v) => !v); }}
              >
                <Plus size={12} />
              </button>
              {mediaMenuOpen && (
                <div className="tree-add-popover" onClick={(e) => e.stopPropagation()}>
                  <button className="popover-item" onClick={() => { setMediaMenuOpen(false); fileInputRef.current?.click(); }}>
                    <Upload size={12} />
                    <span>Import Media</span>
                  </button>
                  <button className="popover-item" onClick={handleQuickSynthAudio} disabled={isGenerating}>
                    <Sparkles size={12} className="text-cyan" />
                    <span>+ Synth Audio</span>
                  </button>
                  <button className="popover-item" onClick={handleQuickMotionVideo} disabled={isGenerating}>
                    <Sparkles size={12} className="text-cyan" />
                    <span>+ Synth Video</span>
                  </button>
                </div>
              )}
            </div>
          </div>
 
          {openFolders.media && (
            <div className="tree-folder-contents">
              {filteredMedia.length === 0 && (
                <p className="tree-empty-hint">No media yet. Use + to import or generate a clip.</p>
              )}
 
              {/* Subfolders (e.g. "Recordings") nested one level under media/ */}
              {mediaSubfolderNames.map((folderName) => {
                const isOpen = !!openMediaSubfolders[folderName];
                const assetsInFolder = filteredMedia.filter((m) => m.folder === folderName);
                return (
                  <div key={folderName} className="tree-folder-group nested">
                    <div className="tree-folder-header" onClick={() => toggleMediaSubfolder(folderName)}>
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {isOpen ? <FolderOpen size={13} className="text-amber" /> : <Folder size={13} className="text-amber" />}
                      <span className="tree-folder-name">{folderName}</span>
                      <span className="tree-folder-count">{assetsInFolder.length}</span>
                    </div>
                    {isOpen && (
                      <div className="tree-folder-contents">
                        {assetsInFolder.map(renderMediaCard)}
                      </div>
                    )}
                  </div>
                );
              })}
 
              {rootMedia.map(renderMediaCard)}
            </div>
          )}
        </div>
 
        {/* ========== scripts/ ========== */}
        <div className="tree-folder-group">
          <div className="tree-folder-header" onClick={() => toggleFolder('scripts')}>
            {openFolders.scripts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {openFolders.scripts ? <FolderOpen size={13} className="text-emerald" /> : <Folder size={13} className="text-emerald" />}
            <span className="tree-folder-name">scripts</span>
            <span className="tree-folder-count">{filteredScripts.length}</span>
            <div className="tree-folder-add-wrapper">
              <button
                className="tree-folder-add-btn"
                title="New script"
                onClick={(e) => { e.stopPropagation(); setScriptsMenuOpen((v) => !v); }}
              >
                <Plus size={12} />
              </button>
              {scriptsMenuOpen && (
                <div className="tree-add-popover" onClick={(e) => e.stopPropagation()}>
                  <button className="popover-item" onClick={handleCreateNewScript}>
                    <FileCode size={12} className="text-emerald" />
                    <span>+ New Script</span>
                  </button>
                </div>
              )}
            </div>
          </div>
 
          {openFolders.scripts && (
            <div className="tree-folder-contents">
              {filteredScripts.length === 0 && (
                <p className="tree-empty-hint">No scripts yet. Use + to create a new script.</p>
              )}
              {filteredScripts.map((script) => {
                const Meta = scriptKindMeta(detectScriptKind(script.code || ''));
                return (
                  <div
                    key={script.id}
                    className="asset-card script-card"
                    onClick={() => onOpenScriptEditor(script)}
                    draggable
                    onDragStart={(e) => handleDragStart(e, 'script', script)}
                  >
                    <div className={`asset-icon-box ${Meta.className}`}>
                      <Meta.icon size={20} />
                    </div>
                    <div className="asset-info-box">
                      <span className="asset-title-main">{script.name}</span>
                      <span className="asset-subtitle">{Meta.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
});
 