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
  ChevronRight,
  Code,
  Share2
} from 'lucide-react';
import { formatTimecode } from '../utils/timeFormat';
import { detectScriptKind } from '../engine/scriptRunner';
import { importMediaFiles } from '../services/mediaImport';
import { isTauri } from '../services/tauriFsAdapter';
import { openProjectInVsCode } from '../services/ideLauncher';

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
 * Every action that existed before (import media, new script buttons,
 * add-to-timeline, delete, drag-to-timeline, search, click-to-edit-script)
 * still works exactly the same — each top-level folder just carries its
 * own "+" popover for the actions that used to live in the tab-specific
 * action row, so they're reachable without a persistent tab context.
 */
export const ProjectPanel = memo(function ProjectPanel({
  mediaAssets,
  prefabs,
  scripts,
  projectFolderHandle,
  // App-wide Shared Library (persists outside any project folder)
  sharedItems = [],
  onRemoveSharedItem,
  onSharePrefab,
  onShareScript,
  onImportSharedItem,
  onAddMediaAsset,
  onRemoveMediaAsset,
  onRemovePrefab,
  onCreateScript,
  onOpenScriptEditor,
  onAddPrefabToTimeline,
  onAddMediaToTimeline,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [openFolders, setOpenFolders] = useState({
    shared: true,
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
 
  const handleCreateNewScript = () => {
    setScriptsMenuOpen(false);
    const newScript = {
      id: `script-${Date.now()}`,
      name: 'NewScript.jsx',
      description: 'Blank JavaScript Motion script',
      code: `export default class NewScript {
  static props = {};
 
  onUpdate({ transform, time }) {
    // Animate transform.x / transform.y / transform.rotation /
    // transform.scaleX / transform.scaleY / transform.opacity here.
    transform.x = Math.sin(time * 2) * 50; // placeholder — replace with your own motion
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
  const filteredShared = sharedItems.filter((i) => i.name.toLowerCase().includes(query));
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

        {/* ========== Shared Library (app-wide, outside any project) ========== */}
        <div className="tree-folder-group">
          <div className="tree-folder-header" onClick={() => toggleFolder('shared')}>
            {openFolders.shared ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {openFolders.shared ? <FolderOpen size={13} className="text-violet" /> : <Folder size={13} className="text-violet" />}
            <span className="tree-folder-name">Shared Library</span>
            <span className="tree-folder-count">{filteredShared.length}</span>
          </div>

          {openFolders.shared && (
            <div className="tree-folder-contents">
              {filteredShared.length === 0 && (
                <p className="tree-empty-hint">
                  App-wide library — use the share button on a prefab or script below to keep it
                  available across every project.
                </p>
              )}
              {filteredShared.map((item) => {
                const isPrefab = item.type === 'prefab';
                return (
                  <div
                    key={item.id}
                    className="asset-card shared-card"
                    title={isPrefab ? 'Shared prefab — add to timeline' : 'Shared script — copy into this project'}
                  >
                    <div className={`asset-icon-box ${isPrefab ? 'text-violet' : 'text-emerald'}`}>
                      {isPrefab ? <Package size={20} /> : <FileCode size={20} />}
                    </div>
                    <div className="asset-info-box">
                      <span className="asset-title-main">{item.name}</span>
                      <span className="asset-subtitle">{isPrefab ? 'Prefab · shared' : 'Script · shared'}</span>
                    </div>
                    <div className="asset-card-btns">
                      <button
                        className="card-action-btn add-btn"
                        title={isPrefab ? 'Add to timeline' : 'Copy into this project'}
                        onClick={() => (isPrefab ? onAddPrefabToTimeline(item.data) : onImportSharedItem(item))}
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        className="card-action-btn del-btn"
                        title="Remove from shared library"
                        onClick={() => onRemoveSharedItem(item.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
                      className="card-action-btn share-btn"
                      title="Save to Shared Library (available in every project)"
                      onClick={() => onSharePrefab(prefab)}
                    >
                      <Share2 size={12} />
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
                </div>
              )}
            </div>
          </div>
 
          {openFolders.media && (
            <div className="tree-folder-contents">
              {filteredMedia.length === 0 && (
                <p className="tree-empty-hint">No media yet. Use + to import a clip.</p>
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
              {projectFolderHandle?.path && isTauri() && (
                <button
                  className="tree-folder-add-btn"
                  title="Open scripts in VS Code"
                  onClick={(e) => { e.stopPropagation(); openProjectInVsCode(projectFolderHandle.path); }}
                  style={{ marginRight: 4 }}
                >
                  <Code size={12} />
                </button>
              )}
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
                    <div className="asset-card-btns">
                      <button
                        className="card-action-btn share-btn"
                        title="Save to Shared Library (available in every project)"
                        onClick={(e) => {
                          e.stopPropagation();
                          onShareScript(script);
                        }}
                      >
                        <Share2 size={12} />
                      </button>
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
 