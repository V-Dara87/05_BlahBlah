import {
  Package,
  Music,
  Film as FilmIcon,
  Clock,
  CornerDownRight,
  Layers,
  Type,
  Square,
  Sparkles,
} from 'lucide-react';
import { detectScriptKind } from '../../engine/scriptRunner';
import { isScriptComponent } from '../../engine/ecs';
import { COMPONENT_TYPE_LABEL, scriptKindMeta, shortDuration } from './projectPanelConstants';
import './asset-preview-popover.css';

/**
 * Hover/click asset previews for the Project panel.
 *
 * Prefabs render an interactive semi-timeline preview showing parent/child
 * hierarchy, object types, and time bars across tracks.
 */
export function AssetPreviewPopover({ x, y, kind, item }) {
  const isPrefab = kind === 'prefab';
  const width = isPrefab ? 340 : 270;
  const maxHeight = isPrefab ? 340 : 220;

  return (
    <div
      className={`asset-hover-preview${isPrefab ? ' is-prefab' : ''}`}
      style={{
        left: Math.min(x + 16, Math.max(10, window.innerWidth - (width + 24))),
        top: Math.min(y + 16, Math.max(10, window.innerHeight - (maxHeight + 24))),
        width: `${width}px`,
        maxHeight: `${maxHeight}px`,
      }}
      onMouseLeave={() => {}}
    >
      {kind === 'media' && <MediaPreview asset={item} />}
      {kind === 'script' && <ScriptPreview script={item} />}
      {kind === 'prefab' && <PrefabPreview prefab={item} />}
    </div>
  );
}

function MediaPreview({ asset }) {
  if (asset?.type === 'video') {
    return (
      <>
        <div className="asset-preview-head">
          <FilmIcon size={12} className="text-indigo" />
          <span className="asset-preview-title">{asset.name}</span>
        </div>
        <video
          className="asset-preview-media"
          src={asset.url}
          muted
          autoPlay
          loop
          playsInline
          preload="metadata"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        <div className="asset-preview-meta">Video · {shortDuration(asset.duration)}</div>
      </>
    );
  }
  return (
    <>
      <div className="asset-preview-head">
        <Music size={12} className="text-emerald" />
        <span className="asset-preview-title">{asset?.name}</span>
      </div>
      <div className="asset-preview-audio">
        <audio
          src={asset?.url}
          muted
          autoPlay
          loop
          controls
          preload="metadata"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      </div>
      <div className="asset-preview-meta">Audio · {shortDuration(asset?.duration)}</div>
    </>
  );
}

function ScriptPreview({ script }) {
  const Meta = scriptKindMeta(detectScriptKind(script?.code || ''));
  const snippet = (script?.code || '').slice(0, 900);
  return (
    <>
      <div className="asset-preview-head">
        <Meta.icon size={12} className={Meta.className} />
        <span className="asset-preview-title">{script?.name}</span>
      </div>
      <pre className="asset-preview-code">
        {snippet}
        {(script?.code || '').length > 900 ? '\n…' : ''}
      </pre>
    </>
  );
}

function getEntityIcon(comps = []) {
  if (comps.some((c) => c.type === 'TextRenderer')) return <Type size={11} className="text-amber" />;
  if (comps.some((c) => c.type === 'ShapeRenderer')) return <Square size={11} className="text-cyan" />;
  if (comps.some((c) => c.type === 'VideoRenderer')) return <FilmIcon size={11} className="text-indigo" />;
  if (comps.some((c) => c.type === 'AudioSource')) return <Music size={11} className="text-emerald" />;
  if (comps.some((c) => isScriptComponent(c))) return <Sparkles size={11} className="text-violet" />;
  return <Layers size={11} className="text-muted" />;
}

// Prefab semi-timeline breakdown: visual timeline tracks and parent/child hierarchy
function PrefabPreview({ prefab }) {
  const snapshots =
    Array.isArray(prefab?.entities) && prefab.entities.length > 0
      ? prefab.entities
      : prefab
      ? [
          {
            id: 'root',
            name: prefab.name?.replace(/\.prefab(\.json)?$/i, ''),
            components: prefab.components || [],
            startTime: 0,
            duration: 5,
          },
        ]
      : [];

  const maxDuration = Math.max(
    0.5,
    ...snapshots.map((s) => (s.startTime || 0) + (s.duration || 5))
  );

  // Group into hierarchy (roots first, then children)
  const roots = snapshots.filter((s) => !s.parentId);
  const childrenMap = new Map();
  snapshots.forEach((s) => {
    if (s.parentId) {
      if (!childrenMap.has(s.parentId)) childrenMap.set(s.parentId, []);
      childrenMap.get(s.parentId).push(s);
    }
  });

  const orderedEntities = [];
  const appendWithChildren = (entity, depth = 0) => {
    orderedEntities.push({ entity, depth });
    const children = childrenMap.get(entity.id) || [];
    children.forEach((child) => appendWithChildren(child, depth + 1));
  };

  if (roots.length > 0) {
    roots.forEach((root) => appendWithChildren(root, 0));
    // Catch any detached entities whose parentId wasn't in roots
    snapshots.forEach((s) => {
      if (!orderedEntities.some((o) => o.entity.id === s.id)) {
        orderedEntities.push({ entity: s, depth: 1 });
      }
    });
  } else {
    snapshots.forEach((s) => orderedEntities.push({ entity: s, depth: 0 }));
  }

  const childCount = snapshots.length - (roots.length || 1);

  return (
    <div className="prefab-semi-timeline">
      {/* Header */}
      <div className="asset-preview-head">
        <Package size={12} className="text-cyan" />
        <span className="asset-preview-title">{prefab?.name}</span>
        <span className="prefab-badge-duration">
          <Clock size={9} />
          {maxDuration.toFixed(1)}s
        </span>
      </div>

      {/* Hierarchy & Object Summary */}
      <div className="prefab-preview-summary">
        <span className="prefab-obj-count">
          {snapshots.length} {snapshots.length === 1 ? 'object' : 'objects'}
        </span>
        {childCount > 0 && (
          <span className="prefab-hierarchy-tag">
            {childCount} {childCount === 1 ? 'child' : 'children'}
          </span>
        )}
        <span className="prefab-hint-edit">Double-click to open in Prefab Mode</span>
      </div>

      {/* Semi Timeline Container */}
      <div className="prefab-timeline-stage">
        {/* Time Ruler */}
        <div className="prefab-time-ruler">
          <span>0s</span>
          <span>{(maxDuration / 2).toFixed(1)}s</span>
          <span>{maxDuration.toFixed(1)}s</span>
        </div>

        {/* Tracks / Objects Rows */}
        <div className="prefab-tracks-list">
          {orderedEntities.map(({ entity, depth }) => {
            const comps = Array.isArray(entity.components) ? entity.components : [];
            const kinds = comps
              .filter((c) => c.type !== 'Transform')
              .map((c) => {
                if (isScriptComponent(c)) return c.scriptName ? `Script (${c.scriptName})` : 'Script';
                return COMPONENT_TYPE_LABEL[c.type] || c.type;
              });

            const start = entity.startTime || 0;
            const dur = entity.duration || 5;
            const leftPct = Math.min(95, Math.max(0, (start / maxDuration) * 100));
            const widthPct = Math.min(100 - leftPct, Math.max(8, (dur / maxDuration) * 100));
            const isChild = depth > 0;

            return (
              <div
                key={entity.id || entity.name}
                className={`prefab-track-row${isChild ? ' is-child' : ' is-root'}`}
              >
                {/* Entity Info / Tree Header */}
                <div
                  className="prefab-track-info"
                  style={{ paddingLeft: `${depth * 14 + 6}px` }}
                >
                  {isChild && <CornerDownRight size={10} className="prefab-child-arrow" />}
                  {getEntityIcon(comps)}
                  <span className="prefab-track-name" title={entity.name}>
                    {entity.name || 'GameObject'}
                  </span>
                  {isChild ? (
                    <span className="prefab-role-pill child">child</span>
                  ) : (
                    snapshots.length > 1 && <span className="prefab-role-pill parent">parent</span>
                  )}
                </div>

                {/* Mini Timeline Bar Lane */}
                <div className="prefab-bar-lane">
                  <div
                    className={`prefab-clip-bar${isChild ? ' child-bar' : ' root-bar'}`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                    }}
                    title={`${entity.name}: ${start.toFixed(1)}s - ${(start + dur).toFixed(1)}s (${dur.toFixed(1)}s)`}
                  >
                    <span className="prefab-clip-bar-text">
                      {kinds[0] || entity.name}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}