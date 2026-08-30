import { useState } from 'react';
import { Clapperboard, Film, Music, Type, Square, Sparkles, Boxes, Search, Trash2 } from 'lucide-react';
import { formatTimecode } from '../utils/timeFormat';
 
// Maps an entity's `type` / component set to an icon + short label, purely
// for display in this list. Mirrors the icon choices already used elsewhere
// (ProjectPanel's Film/Music icons, UnityInspector's script-type colors) so
// a clip looks the same whether you're seeing it here, on the timeline, or
// in the Inspector.
function describeEntity(entity) {
  const hasReact = entity.components?.some((c) => c.type === 'ReactRenderer');
  const hasCanvas = entity.components?.some((c) => c.type === 'CanvasRenderer');
  const hasText = entity.components?.some((c) => c.type === 'TextRenderer');
  const hasShape = entity.components?.some((c) => c.type === 'ShapeRenderer');
 
  if (hasCanvas) return { icon: Boxes, label: 'Canvas Component', color: 'text-cyan' };
  if (hasReact) return { icon: Sparkles, label: 'React Clip', color: 'text-cyan' };
  if (hasText) return { icon: Type, label: 'Text', color: 'text-violet' };
  if (hasShape) return { icon: Square, label: 'Shape', color: 'text-indigo' };
  if (entity.type === 'audio') return { icon: Music, label: 'Audio', color: 'text-emerald' };
  return { icon: Film, label: 'Video', color: 'text-indigo' };
}
 
/**
 * P1.5-adjacent — "Clips" tab.
 *
 * Lists every entity actually placed on the timeline, as its own tab
 * alongside Prefabs/Media/Scripts in the Project dock area (kept as a
 * separate panel component, not folded into ProjectPanel's internal tabs,
 * so it can be dropped into its own dockview group/position independently).
 *
 * Deliberately read-only + select/delete only: `entities` already is the
 * flat "all clips on the timeline" array (see engine/ecs.js createGameObject
 * and App.jsx), so this needed no new state — it's a different view over
 * data that already exists, not a new source of truth. Kept separate from
 * Prefabs on purpose (per design discussion): a prefab is a reusable
 * template; a clip here is a live instance already on a track. Selecting a
 * clip here mirrors selecting it on the timeline/canvas (same
 * selectedEntityId), so the Inspector updates the same way either path.
 */
export function ClipListPanel({ entities, tracks, selectedEntityId, onSelectEntity, onDeleteEntity }) {
  const [searchQuery, setSearchQuery] = useState('');
 
  const trackName = (trackId) => tracks.find((t) => t.id === trackId)?.name || trackId;
 
  const filtered = entities.filter((e) =>
    e.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
 
  return (
    <aside className="project-panel">
      <div className="panel-top-header">
        <h3 className="panel-title-text">Clips</h3>
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
 
      <div className="project-actions-row">
        <p className="tab-helper-text">
          {entities.length} clip{entities.length === 1 ? '' : 's'} on the timeline. Click to select.
        </p>
      </div>
 
      <div className="project-asset-list">
        {filtered.length === 0 && (
          <p className="hint-text-sm">
            {entities.length === 0 ? 'No clips on the timeline yet.' : 'No clips match your search.'}
          </p>
        )}
        {filtered.map((entity) => {
          const { icon: Icon, label, color } = describeEntity(entity);
          const isSelected = entity.id === selectedEntityId;
          return (
            <div
              key={entity.id}
              className={`asset-card clip-list-card ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectEntity(entity.id)}
            >
              <div className={`asset-icon-box ${color}`}>
                <Icon size={20} />
                <span className="duration-tag">{formatTimecode(entity.duration).slice(3)}</span>
              </div>
              <div className="asset-info-box">
                <span className="asset-title-main">{entity.name}</span>
                <span className="asset-subtitle">
                  {label} &middot; {trackName(entity.trackId)}
                </span>
              </div>
              <div className="asset-card-btns">
                <button
                  className="card-action-btn del-btn"
                  title="Delete clip"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteEntity(entity.id);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
 
// Small tab icon export so DockLayout/panels.jsx can use a clip-specific
// glyph for the dockview tab itself, matching ProjectPanel's per-tab icons.
export const ClipListTabIcon = Clapperboard;
 