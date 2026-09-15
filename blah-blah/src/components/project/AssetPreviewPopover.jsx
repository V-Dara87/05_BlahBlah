import { Package, Music, Film as FilmIcon } from 'lucide-react';
import { detectScriptKind } from '../../engine/scriptRunner';
import { isScriptComponent } from '../../engine/ecs';
import { COMPONENT_TYPE_LABEL, scriptKindMeta, shortDuration } from './projectPanelConstants';
import './asset-preview-popover.css';
 
/**
 * Hover/click asset previews for the Project panel.
 *
 * <AssetPreviewPopover> is the positioned shell; the three inner previews
 * (media / script / prefab) are private to this module. Extracted from
 * ProjectPanel.jsx — purely presentational, no panel state.
 */
export function AssetPreviewPopover({ x, y, kind, item }) {
  return (
    <div className="asset-hover-preview" style={{ left: Math.min(x + 16, window.innerWidth - 300), top: Math.min(y + 16, window.innerHeight - 200) }} onMouseLeave={() => {}}>
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
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
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
        <audio src={asset?.url} muted autoPlay loop controls preload="metadata" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
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
 
// Prefab breakdown: component summary of every snapshot.
function PrefabPreview({ prefab }) {
  const snapshots = (Array.isArray(prefab?.entities) && prefab.entities.length > 0 ? prefab.entities : null);
  const roots = snapshots || (prefab ? [{ components: prefab.components || [], name: prefab.name }] : []);
  return (
    <>
      <div className="asset-preview-head">
        <Package size={12} className="text-cyan" />
        <span className="asset-preview-title">{prefab?.name}</span>
      </div>
      <div className="asset-preview-breakdown">
        {roots.map((entity) => {
          const comps = Array.isArray(entity.components) ? entity.components : [];
          const kinds = comps
            .filter((c) => c.type !== 'Transform')
            .map((c) => {
              if (isScriptComponent(c)) return `Script · ${c.scriptName || ''}`;
              return COMPONENT_TYPE_LABEL[c.type] || c.type;
            });
          return (
            <div key={entity.id || entity.name} className="preview-entity-row">
              <span className="preview-entity-name">{entity.name || prefab?.name}</span>
              <span className="preview-entity-comps">{kinds.length ? kinds.join(' · ') : 'empty'}</span>
            </div>
          );
        })}
        {snapshots && snapshots.length > 1 && (
          <div className="asset-preview-meta">{snapshots.length} objects · hierarchical</div>
        )}
      </div>
    </>
  );
}