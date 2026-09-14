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

// ─── EntityRefSlot ────────────────────────────────────────────────────────────

/**
 * A drag-drop + dropdown slot for entity references.
 *
 * Props:
 *   value       — entity ID string (or null)
 *   onChange    — (newEntityId: string|null) => void
 *   entities    — all entities array
 */
export function EntityRefSlot({ value, onChange, entities = [], emptyLabel = 'None (Entity)' }) {
  const [isDragOver, setIsDragOver] = useState(false);

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
      if (entityId) onChange(entityId);
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange(null);
  };

  return (
    <div
      className={`ref-slot ref-slot-entity${isDragOver ? ' ref-slot-dragover' : ''}${value ? ' ref-slot-assigned' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title="Select or drag a clip from the timeline"
    >
      <Link2 size={11} className="ref-slot-icon text-cyan" />
      <select
        className="ref-slot-select"
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{emptyLabel}</option>
        {entities.map((ent) => (
          <option key={ent.id} value={ent.id}>
            {ent.name}
          </option>
        ))}
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
 *
 * Props:
 *   value       — asset ID string (or null)
 *   onChange    — (newAssetId: string|null) => void
 *   mediaAssets — all mediaAssets array
 */
export function AssetRefSlot({ value, onChange, mediaAssets = [] }) {
  const [isDragOver, setIsDragOver] = useState(false);

  const resolvedAsset = value ? mediaAssets.find((a) => a.id === value) : null;
  const assetType = resolvedAsset?.type ?? null;

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
    if (assetId) onChange(assetId);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange(null);
  };

  return (
    <div
      className={`ref-slot ref-slot-asset${isDragOver ? ' ref-slot-dragover' : ''}${value ? ' ref-slot-assigned' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title="Select or drag an asset from the Project panel"
    >
      <AssetIcon type={assetType} />
      <select
        className="ref-slot-select"
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">None (Asset)</option>
        {mediaAssets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.name} ({asset.type || 'media'})
          </option>
        ))}
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
