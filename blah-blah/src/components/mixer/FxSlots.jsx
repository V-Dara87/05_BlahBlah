import { useCallback, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Power,
  Plus,
  Settings2,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { ensureFxStateFile } from '../../services/trackFxBounce';
import { createFxSlot, MAX_FX_SLOTS } from '../../utils/fxChain';
import { useTrackFxEntry } from '../../utils/trackFxStore';
import { PluginPicker } from './PluginPicker';
import './fx-slots.css';

function pickerPosition(rect) {
  const width = 360;
  const height = 420;
  return {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8)),
    width,
    maxHeight: height,
  };
}

/**
 * The per-track insert chain shown in a mixer strip. Every mutation is one
 * `onUpdateTrack` call, so add/remove/reorder/bypass are each one undo step.
 */
export function FxSlots({
  track,
  vstEnabled = false,
  projectFolderHandle = null,
  onUpdateTrack,
  onOpenEditor,
  onBounce,
  onAudition,
}) {
  const slots = useMemo(() => (Array.isArray(track?.fx) ? track.fx : []), [track?.fx]);
  const entry = useTrackFxEntry(track?.id);
  const [picker, setPicker] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const disabled = !vstEnabled || !projectFolderHandle;
  const disabledReason = !projectFolderHandle
    ? 'Save the project to a folder first (VST3 inserts need a project folder)'
    : !vstEnabled
      ? 'VST3 is turned off — enable it in Settings > Audio'
      : '';

  const update = useCallback((patch) => {
    if (onUpdateTrack) onUpdateTrack(track.id, patch);
  }, [onUpdateTrack, track?.id]);

  const handlePick = useCallback(async (plugin) => {
    if (disabled) return;
    setBusy(true);
    try {
      const created = createFxSlot(plugin);
      const state = await ensureFxStateFile({ projectFolderHandle, slot: created });
      const slot = state ? { ...created, ...state } : created;
      update({ fx: [...slots, slot].slice(0, MAX_FX_SLOTS) });
      setPicker(null);
      setError(null);
    } catch (err) {
      console.warn('Could not add VST3 insert:', err);
      setPicker(null);
      setError(`Could not add plugin: ${String(err?.message || err)}`);
    } finally {
      setBusy(false);
    }
  }, [disabled, projectFolderHandle, slots, update]);

  const handleBypass = useCallback((slot) => {
    update({ fx: slots.map((item) => (item.id === slot.id ? { ...item, bypass: !item.bypass } : item)) });
  }, [slots, update]);

  const handleRemove = useCallback((slot) => {
    update({ fx: slots.filter((item) => item.id !== slot.id) });
  }, [slots, update]);

  const handleMove = useCallback((index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= slots.length) return;
    const next = [...slots];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    update({ fx: next });
  }, [slots, update]);

  const handleEdit = useCallback(async (slot) => {
    if (!onOpenEditor || disabled) return;
    setEditingId(slot.id);
    setError(null);
    try {
      await onOpenEditor(track.id, slot.id);
    } catch (err) {
      console.warn('Could not open VST editor:', err);
      setError(`Could not open editor: ${String(err?.message || err)}`);
    } finally {
      setEditingId(null);
    }
  }, [disabled, onOpenEditor, track?.id]);

  const status = entry?.status;
  const statusClass = entry?.active ? 'is-ready' : status === 'error' ? 'is-error' : status ? 'is-pending' : 'is-dry';

  return (
    <div className={`fx-slots ${track?.fxBypassAll ? 'is-bypassed' : ''}`}>
      <div className="fx-slots-head">
        <span className="fx-slots-title">
          <SlidersHorizontal size={9} />
          INSERTS
          <i className={`fx-status-dot ${statusClass}`} title={entry?.error || status || 'dry'} />
        </span>
        <div className="fx-slots-head-actions">
          {onAudition && slots.length > 0 && (
            <button type="button" className="fx-all-btn" onClick={() => onAudition(track.id)} title="Audition this chain">AUD</button>
          )}
          {onBounce && slots.length > 0 && (
            <button type="button" className="fx-all-btn" onClick={() => onBounce(track.id)} title="Rebuild this chain's wet bounce">↻</button>
          )}
          <button
            type="button"
            className={`fx-all-btn ${track?.fxBypassAll ? 'active' : ''}`}
            onClick={() => update({ fxBypassAll: !track?.fxBypassAll })}
            title={track?.fxBypassAll ? 'Enable all inserts' : 'Bypass all inserts'}
            disabled={slots.length === 0}
          >
            ALL
          </button>
        </div>
      </div>

      <div className="fx-slot-list">
        {slots.map((slot, index) => (
          <div key={slot.id} className={`fx-slot ${slot.bypass ? 'is-slot-bypassed' : ''}`} title={slot.pluginPath}>
            <button
              type="button"
              className={`fx-slot-power ${slot.bypass ? '' : 'on'}`}
              onClick={() => handleBypass(slot)}
              title={slot.bypass ? 'Enable insert' : 'Bypass insert'}
            >
              <Power size={9} />
            </button>
            <button
              type="button"
              className="fx-slot-name"
              onClick={() => handleEdit(slot)}
              disabled={!onOpenEditor || disabled || editingId === slot.id}
              title={disabled ? disabledReason : !onOpenEditor ? 'Plugin editors only open in the desktop app' : 'Open plugin editor'}
            >
              {editingId === slot.id ? 'Editing…' : slot.name}
            </button>
            <div className="fx-slot-actions">
              <button type="button" onClick={() => handleMove(index, -1)} disabled={index === 0} title="Move up"><ArrowUp size={8} /></button>
              <button type="button" onClick={() => handleMove(index, 1)} disabled={index === slots.length - 1} title="Move down"><ArrowDown size={8} /></button>
              <button type="button" onClick={() => handleEdit(slot)} disabled={!onOpenEditor || disabled} title="Edit"><Settings2 size={8} /></button>
              <button type="button" onClick={() => handleRemove(slot)} title="Remove"><Trash2 size={8} /></button>
            </div>
          </div>
        ))}

        {slots.length < MAX_FX_SLOTS && (
          <button
            type="button"
            className="fx-add-slot"
            disabled={disabled || busy}
            title={disabled ? (disabledReason || 'VST3 inserts require the desktop app and a saved project') : 'Add a VST3 insert'}
            onClick={(event) => setPicker(pickerPosition(event.currentTarget.getBoundingClientRect()))}
          >
            <Plus size={9} />
            {busy ? 'Preparing…' : 'Add VST3'}
          </button>
        )}
      </div>

      {error && (
        <div
          className="fx-slots-error"
          role="alert"
          style={{ color: '#f87171', fontSize: 9, lineHeight: 1.3, padding: '2px 4px', wordBreak: 'break-word', cursor: 'pointer' }}
          title="Click to dismiss"
          onClick={() => setError(null)}
        >
          {error}
        </div>
      )}

      {picker && (
        <PluginPicker
          onPick={handlePick}
          onClose={() => setPicker(null)}
          style={picker}
        />
      )}
    </div>
  );
}