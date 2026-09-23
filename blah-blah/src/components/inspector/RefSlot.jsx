/**
 * RefSlot.jsx — Inspector UI for reference-typed script props.
 *
 * Supports both:
 *   1. Dropdown select: Click to pick from any clip on the timeline or asset in the project.
 *   2. Drag & drop: Drag a timeline clip icon or Project panel media asset onto the slot.
 */

import { useState } from 'react';
import { Link2, Film, Music, Image, X, SquareDashed } from 'lucide-react';
import { readDragPayload } from '../../utils/dragData';
import './ref-slot.css';

function formatSec(sec) {
  if (!Number.isFinite(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
}

// ─── EntityRefSlot ────────────────────────────────────────────────────────────

/**
 * A drag-drop + dropdown slot for entity references.
 * Supports auto-filtering by `targetComponent` and smart auto-ID/timeline labelling.
 *
 * Props:
 *   value           — entity ID string (or null)
 *   onChange        — (newEntityId: string|null) => void
 *   entities        — all entities array
 *   tracks          — all timeline tracks array (for track name display)
 *   targetComponent — optional component type filter (e.g. 'AudioSource', 'SubtitleTrack')
 *   emptyLabel      — label for empty state
 */
export function EntityRefSlot({
  value,
  onChange,
  entities = [],
  tracks = [],
  targetComponent,
  emptyLabel,
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const filteredEntities = targetComponent
    ? entities.filter((ent) => ent.components?.some((c) => c.type === targetComponent))
    : entities;

  const handleDragOver = (e) => {
    const types = e.dataTransfer?.types || [];
    const hasEntity = Array.prototype.some.call(types, (t) =>
      t === 'application/x-blahblah-item-entity' ||
      t === 'application/x-blahblah-item-media'
    );
    if (hasEntity) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const payload = readDragPayload(e.dataTransfer);
    if (!payload) return;

    if (payload.itemType === 'entity') {
      const entityId = payload.itemData?.id;
      if (entityId) {
        if (targetComponent) {
          const targetEnt = entities.find((ent) => ent.id === entityId);
          const hasComp = targetEnt?.components?.some((c) => c.type === targetComponent);
          if (!hasComp) return;
        }
        onChange(entityId);
      }
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange(null);
  };

  const slotIcon = targetComponent === 'AudioSource' ? (
    <Music size={11} className="ref-slot-icon text-violet" />
  ) : targetComponent === 'VideoRenderer' ? (
    <Film size={11} className="ref-slot-icon text-emerald" />
  ) : (
    <Link2 size={11} className="ref-slot-icon text-cyan" />
  );

  const resolvedEmptyLabel = emptyLabel || (targetComponent ? `None (${targetComponent})` : 'None (Entity)');

  return (
    <div
      className={`ref-slot ref-slot-entity${isDragOver ? ' ref-slot-dragover' : ''}${value ? ' ref-slot-assigned' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title={targetComponent ? `Select or drag a clip with ${targetComponent}` : 'Select or drag a clip from the timeline'}
    >
      {slotIcon}
      <select
        className="ref-slot-select"
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{resolvedEmptyLabel}</option>
        {filteredEntities.map((ent) => {
          const track = tracks.find((t) => t.id === ent.trackId);
          const trackName = track?.name || ent.trackId || 'Track';
          const start = ent.startTime ?? 0;
          const end = start + (ent.duration ?? 0);
          const timeRange = `${formatSec(start)} - ${formatSec(end)}`;
          const shortId = ent.id ? `#${ent.id.slice(-4)}` : '';
          return (
            <option key={ent.id} value={ent.id}>
              [{trackName}] {ent.name} ({timeRange}) {shortId}
            </option>
          );
        })}
        {value && !filteredEntities.some((e) => e.id === value) && (() => {
          const ent = entities.find((e) => e.id === value);
          return ent ? (
            <option key={ent.id} value={ent.id}>
              {ent.name} (Incompatible)
            </option>
          ) : null;
        })()}
      </select>
      {value && (
        <button
          type="button"
          className="ref-slot-clear"
          onClick={handleClear}
          title="Clear reference"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

// ─── AssetRefSlot ─────────────────────────────────────────────────────────────

/** Icon for each asset type */
function AssetIcon({ type }) {
  if (type === 'video') return <Film size={11} className="ref-slot-icon text-emerald" />;
  if (type === 'audio') return <Music size={11} className="ref-slot-icon text-violet" />;
  if (type === 'image') return <Image size={11} className="ref-slot-icon text-amber" />;
  return <SquareDashed size={11} className="ref-slot-icon text-muted" />;
}

/**
 * A drag-drop + dropdown slot for media asset references.
 * Supports auto-filtering by `assetType` ('audio', 'video', 'image').
 *
 * Props:
 *   value       — asset ID string (or null)
 *   onChange    — (newAssetId: string|null) => void
 *   mediaAssets — all mediaAssets array
 *   assetType   — optional asset type filter ('audio'|'video'|'image')
 *   emptyLabel  — label for empty state
 */
export function AssetRefSlot({
  value,
  onChange,
  mediaAssets = [],
  assetType,
  emptyLabel,
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const resolvedAsset = value ? mediaAssets.find((a) => a.id === value) : null;
  const effectiveAssetType = resolvedAsset?.type ?? assetType ?? null;

  const filteredAssets = assetType
    ? mediaAssets.filter((a) => a.type === assetType)
    : mediaAssets;

  const handleDragOver = (e) => {
    const types = e.dataTransfer?.types || [];
    const hasMedia = Array.prototype.some.call(types, (t) =>
      t === 'application/x-blahblah-item-media'
    );
    if (hasMedia) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const payload = readDragPayload(e.dataTransfer);
    if (!payload || payload.itemType !== 'media') return;
    const assetId = payload.itemData?.id;
    if (assetId) {
      if (assetType) {
        const targetAst = mediaAssets.find((a) => a.id === assetId);
        if (targetAst && targetAst.type !== assetType) return;
      }
      onChange(assetId);
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange(null);
  };

  const resolvedEmptyLabel = emptyLabel || (assetType ? `None (${assetType})` : 'None (Asset)');

  return (
    <div
      className={`ref-slot ref-slot-asset${isDragOver ? ' ref-slot-dragover' : ''}${value ? ' ref-slot-assigned' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title={assetType ? `Select or drag a ${assetType} asset from the Project panel` : 'Select or drag an asset from the Project panel'}
    >
      <AssetIcon type={effectiveAssetType} />
      <select
        className="ref-slot-select"
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{resolvedEmptyLabel}</option>
        {filteredAssets.map((asset) => {
          const dur = asset.duration ? ` (${formatSec(asset.duration)})` : '';
          return (
            <option key={asset.id} value={asset.id}>
              {asset.name}{dur}
            </option>
          );
        })}
        {value && !filteredAssets.some((a) => a.id === value) && (() => {
          const ast = mediaAssets.find((a) => a.id === value);
          return ast ? (
            <option key={ast.id} value={ast.id}>
              {ast.name} (Incompatible)
            </option>
          ) : null;
        })()}
      </select>
      {value && (
        <button
          type="button"
          className="ref-slot-clear"
          onClick={handleClear}
          title="Clear reference"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

