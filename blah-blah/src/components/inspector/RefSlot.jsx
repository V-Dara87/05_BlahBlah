/**
 * RefSlot.jsx — Inspector UI for reference-typed script props.
 *
 * Two components:
 *   - EntityRefSlot: accepts a timeline clip dragged from the Timeline or Project panel,
 *                    or selected via a Unity-style circle picker popover (⊙).
 *   - AssetRefSlot:  accepts a media asset dragged from the Project panel,
 *                    or selected via a Unity-style circle picker popover (⊙).
 */

import { useState, useRef, useEffect } from 'react';
import { Link2, Film, Music, Image, X, SquareDashed, Disc, Search } from 'lucide-react';
import { readDragPayload } from '../../utils/dragData';

// ─── EntityRefSlot ────────────────────────────────────────────────────────────

/**
 * A drag-drop + picker slot for entity references.
 *
 * Props:
 *   value       — entity ID string (or null)
 *   onChange    — (newEntityId: string|null) => void
 *   entities    — all entities array, used to look up the name
 */
export function EntityRefSlot({ value, onChange, entities = [] }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const popoverRef = useRef(null);

  const resolvedEntity = value ? entities.find((e) => e.id === value) : null;
  const displayName = resolvedEntity ? resolvedEntity.name : 'None (Entity)';

  // Close picker popover on click outside
  useEffect(() => {
    if (!isPickerOpen) return;
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [isPickerOpen]);

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

  const filteredEntities = entities.filter((e) =>
    e.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="ref-slot-container" ref={popoverRef}>
      <div
        className={`ref-slot ref-slot-entity${isDragOver ? ' ref-slot-dragover' : ''}${value ? ' ref-slot-assigned' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => setIsPickerOpen(!isPickerOpen)}
        title={value ? `Entity: ${displayName}\nClick or drag to change` : 'Click to pick or drag a clip from the timeline'}
      >
        <Link2 size={11} className="ref-slot-icon text-cyan" />
        <span className="ref-slot-name">{displayName}</span>
        
        <button
          type="button"
          className="ref-slot-picker-btn"
          onClick={(e) => {
            e.stopPropagation();
            setIsPickerOpen(!isPickerOpen);
          }}
          title="Select Entity"
        >
          <Disc size={11} />
        </button>

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

      {isPickerOpen && (
        <div className="ref-slot-popover">
          <div className="ref-slot-search">
            <Search size={11} className="text-muted" />
            <input
              type="text"
              autoFocus
              placeholder="Search clip…"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="ref-slot-list">
            <div
              className={`ref-slot-item ${!value ? 'selected' : ''}`}
              onClick={() => {
                onChange(null);
                setIsPickerOpen(false);
              }}
            >
              <span className="text-dim">None</span>
            </div>
            {filteredEntities.map((e) => (
              <div
                key={e.id}
                className={`ref-slot-item ${value === e.id ? 'selected' : ''}`}
                onClick={() => {
                  onChange(e.id);
                  setIsPickerOpen(false);
                }}
              >
                <Link2 size={10} className="text-cyan" />
                <span className="ref-slot-item-name">{e.name}</span>
              </div>
            ))}
            {filteredEntities.length === 0 && (
              <div className="ref-slot-empty-hint">No matching clips found</div>
            )}
          </div>
        </div>
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
 * A drag-drop + picker slot for media asset references.
 *
 * Props:
 *   value       — asset ID string (or null)
 *   onChange    — (newAssetId: string|null) => void
 *   mediaAssets — all mediaAssets array, used to look up the name/type
 */
export function AssetRefSlot({ value, onChange, mediaAssets = [] }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const popoverRef = useRef(null);

  const resolvedAsset = value ? mediaAssets.find((a) => a.id === value) : null;
  const displayName = resolvedAsset ? resolvedAsset.name : 'None (Asset)';
  const assetType = resolvedAsset?.type ?? null;

  // Close picker popover on click outside
  useEffect(() => {
    if (!isPickerOpen) return;
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [isPickerOpen]);

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

  const filteredAssets = mediaAssets.filter((a) =>
    a.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="ref-slot-container" ref={popoverRef}>
      <div
        className={`ref-slot ref-slot-asset${isDragOver ? ' ref-slot-dragover' : ''}${value ? ' ref-slot-assigned' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => setIsPickerOpen(!isPickerOpen)}
        title={value ? `Asset: ${displayName}\nClick or drag to change` : 'Click to pick or drag an asset from the Project panel'}
      >
        <AssetIcon type={assetType} />
        <span className="ref-slot-name">{displayName}</span>

        <button
          type="button"
          className="ref-slot-picker-btn"
          onClick={(e) => {
            e.stopPropagation();
            setIsPickerOpen(!isPickerOpen);
          }}
          title="Select Media Asset"
        >
          <Disc size={11} />
        </button>

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

      {isPickerOpen && (
        <div className="ref-slot-popover">
          <div className="ref-slot-search">
            <Search size={11} className="text-muted" />
            <input
              type="text"
              autoFocus
              placeholder="Search asset…"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="ref-slot-list">
            <div
              className={`ref-slot-item ${!value ? 'selected' : ''}`}
              onClick={() => {
                onChange(null);
                setIsPickerOpen(false);
              }}
            >
              <span className="text-dim">None</span>
            </div>
            {filteredAssets.map((a) => (
              <div
                key={a.id}
                className={`ref-slot-item ${value === a.id ? 'selected' : ''}`}
                onClick={() => {
                  onChange(a.id);
                  setIsPickerOpen(false);
                }}
              >
                <AssetIcon type={a.type} />
                <span className="ref-slot-item-name">{a.name}</span>
              </div>
            ))}
            {filteredAssets.length === 0 && (
              <div className="ref-slot-empty-hint">No matching assets found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
