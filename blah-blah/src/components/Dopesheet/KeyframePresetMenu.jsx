import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, Download, Upload, Trash2 } from 'lucide-react';
import {
  createKeyframePreset, presetStats, planPresetApply, applyPresetPlan,
  serializePresets, parsePresetFile,
} from '../../engine/keyframePresets';
import { loadKeyframePresets, saveKeyframePresets } from '../../services/keyframePresetStorage';
import { isTauri } from '../../services/tauriFsAdapter';
import './keyframe-preset-menu.css';

/**
 * Presets menu of the Dopesheet toolbar.
 *
 *  - Save: the currently selected keyframes (any number, across parameters and
 *    components) become one named preset in the app-wide library.
 *  - Apply: puts a preset on the selected clip at the playhead.
 *      1. Components the clip has are applied as they are (parameters by name).
 *      2. If something is missing, the menu says what, and offers
 *      3. "Map by position": component N -> component N, parameter N -> parameter N.
 *  - Export / Import: presets as .json files, to share between machines.
 */

const MENU_W = 360;

/** Save text as a file: native Save dialog in Tauri, a download in the browser. */
async function saveTextFile(fileName, text) {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      title: 'Export keyframe presets',
      defaultPath: fileName,
      filters: [{ name: 'Keyframe presets', extensions: ['json'] }],
    });
    if (!path) return false;
    const { allowUserPath } = await import('../../services/tauriFsAdapter');
    await allowUserPath(path);
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, text);
    return true;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Ask the user for one .json file. Resolves the File, or null if cancelled. */
function pickJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

const slug = (s) => String(s).trim().replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'keyframe-preset';

export function KeyframePresetMenu({
  entity,
  targets,
  selectedKeyIds,
  applyTime,
  onCommitKeyframes,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [presets, setPresets] = useState(() => loadKeyframePresets());
  const [name, setName] = useState('');
  const [status, setStatus] = useState(null); // { kind: 'ok' | 'warn' | 'error', text }
  const [pending, setPending] = useState(null); // { preset, plan } — waiting for the user's choice
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8));
    const below = window.innerHeight - r.bottom;
    if (below < 340 && r.top > below) {
      setPos({ left, bottom: window.innerHeight - r.top + 4, maxHeight: r.top - 12 });
    } else {
      setPos({ left, top: r.bottom + 4, maxHeight: below - 12 });
    }
    setStatus(null);
    setPending(null);
    setOpen(true);
  };

  const persist = (next) => {
    setPresets(next);
    if (!saveKeyframePresets(next)) {
      setStatus({ kind: 'warn', text: 'Could not write to browser storage: presets last until you close the app. Use Export to keep them.' });
      return false;
    }
    return true;
  };

  const selectedCount = selectedKeyIds?.size || 0;

  const handleSave = () => {
    const preset = createKeyframePreset(entity, selectedKeyIds, targets, name || `Preset ${presets.length + 1}`);
    if (!preset) {
      setStatus({ kind: 'warn', text: 'Select one or more keyframes first (click, Shift-click or box-select).' });
      return;
    }
    const s = presetStats(preset);
    if (persist([...presets, preset])) {
      setStatus({ kind: 'ok', text: `Saved "${preset.name}": ${s.keys} keyframes, ${s.params} parameters, ${s.components} component${s.components === 1 ? '' : 's'}.` });
    }
    setName('');
  };

  const commit = (plan, label) => {
    if (!entity || plan.items.length === 0) return 0;
    const { keyframes, count } = applyPresetPlan(entity, plan.items, applyTime);
    onCommitKeyframes(keyframes);
    setStatus({
      kind: plan.issues.length > 0 ? 'warn' : 'ok',
      text: `${label}: ${count} keyframes on ${plan.items.length} parameter${plan.items.length === 1 ? '' : 's'}`
        + (plan.issues.length > 0 ? `, ${plan.issues.length} skipped.` : '.'),
    });
    return count;
  };

  const handleApply = (preset) => {
    if (!entity) return;
    const plan = planPresetApply(preset, targets);
    if (plan.issues.length === 0) {
      setPending(null);
      commit(plan, `Applied "${preset.name}"`);
      return;
    }
    setStatus(null);
    setPending({ preset, plan });
  };

  const handleMapByPosition = () => {
    if (!pending) return;
    const plan = planPresetApply(pending.preset, targets, { byPosition: true });
    if (plan.items.length === 0) {
      setPending({ preset: pending.preset, plan, positionTried: true });
      return;
    }
    const { preset } = pending;
    setPending(null);
    commit(plan, `Applied "${preset.name}" by position`);
  };

  const handleApplyMatching = () => {
    if (!pending) return;
    const { preset, plan } = pending;
    setPending(null);
    commit(plan, `Applied "${preset.name}"`);
  };

  const handleDelete = (preset) => {
    if (!window.confirm(`Delete the preset "${preset.name}"?`)) return;
    setPending(null);
    persist(presets.filter((p) => p.id !== preset.id));
  };

  const handleExport = async (list, fileName) => {
    try {
      const done = await saveTextFile(fileName, serializePresets(list));
      if (done) setStatus({ kind: 'ok', text: `Exported ${list.length} preset${list.length === 1 ? '' : 's'}.` });
    } catch (err) {
      setStatus({ kind: 'error', text: `Could not export: ${err?.message || err}` });
    }
  };

  const handleImport = async () => {
    const file = await pickJsonFile();
    if (!file) return;
    try {
      const incoming = parsePresetFile(await file.text());
      if (persist([...presets, ...incoming])) {
        setStatus({ kind: 'ok', text: `Imported ${incoming.length} preset${incoming.length === 1 ? '' : 's'}.` });
      }
    } catch (err) {
      setStatus({ kind: 'error', text: err?.message || String(err) });
    }
  };

  const stop = (e) => e.stopPropagation();

  const menu = open && pos && createPortal(
    <div
      ref={menuRef}
      className="kf-preset-menu"
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight, width: MENU_W }}
      onKeyDown={stop}
      onPointerDown={stop}
    >
      <div className="kf-preset-section">
        <div className="kf-preset-title">Save selected keyframes</div>
        <div className="kf-preset-row">
          <input
            className="kf-preset-input"
            value={name}
            placeholder={`Preset ${presets.length + 1}`}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
            }}
          />
          <button className="kf-preset-btn primary" disabled={selectedCount === 0} onClick={handleSave}>
            Save
          </button>
        </div>
        <div className="kf-preset-hint">
          {selectedCount > 0
            ? `${selectedCount} keyframe${selectedCount === 1 ? '' : 's'} selected: any mix of parameters and components is saved together.`
            : 'Select keyframes in the Dopesheet or Graph first. Select many to save them as one preset.'}
        </div>
      </div>

      <div className="kf-preset-section kf-preset-list">
        <div className="kf-preset-title">
          Presets
          <span className="kf-preset-sub">applied at the playhead of the selected clip</span>
        </div>
        {presets.length === 0 && <div className="kf-preset-hint">No presets yet.</div>}
        {presets.map((p) => {
          const s = presetStats(p);
          return (
            <div key={p.id} className="kf-preset-item">
              <div className="kf-preset-item-main">
                <span className="kf-preset-item-name" title={p.name}>{p.name}</span>
                <span className="kf-preset-item-meta">
                  {s.keys} keys · {s.params} param{s.params === 1 ? '' : 's'} · {p.tracks.map((t) => t.label).join(', ')}
                </span>
              </div>
              <button className="kf-preset-btn" disabled={!entity} onClick={() => handleApply(p)} title="Apply at the playhead">
                Apply
              </button>
              <button
                className="kf-preset-icon"
                title="Export this preset as a file"
                onClick={() => handleExport([p], `${slug(p.name)}.bbkeys.json`)}
              >
                <Download size={12} />
              </button>
              <button className="kf-preset-icon" title="Delete preset" onClick={() => handleDelete(p)}>
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {pending && (
        <div className="kf-preset-warning">
          <div className="kf-preset-title">
            {pending.positionTried
              ? 'Nothing could be matched by position either'
              : `"${pending.preset.name}" does not fully fit this clip`}
          </div>
          <ul>
            {pending.plan.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}
          </ul>
          <div className="kf-preset-row wrap">
            {pending.plan.items.length > 0 && !pending.positionTried && (
              <button className="kf-preset-btn" onClick={handleApplyMatching}>
                Apply what matches ({pending.plan.items.length})
              </button>
            )}
            {pending.plan.unmatchedTracks > 0 && !pending.positionTried && (
              <button
                className="kf-preset-btn primary"
                onClick={handleMapByPosition}
                title="Component 1 -> component 1, parameter 1 -> parameter 1, ..."
              >
                Map by position
              </button>
            )}
            <button className="kf-preset-btn" onClick={() => setPending(null)}>Cancel</button>
          </div>
          {pending.plan.unmatchedTracks > 0 && !pending.positionTried && (
            <div className="kf-preset-hint">
              Map by position puts a missing component on the component at the same position
              on this clip, and each parameter on the parameter at the same position.
            </div>
          )}
        </div>
      )}

      {status && <div className={`kf-preset-status ${status.kind}`}>{status.text}</div>}

      <div className="kf-preset-footer">
        <button className="kf-preset-btn" onClick={handleImport}>
          <Upload size={12} /> Import file
        </button>
        <button
          className="kf-preset-btn"
          disabled={presets.length === 0}
          onClick={() => handleExport(presets, 'keyframe-presets.bbkeys.json')}
        >
          <Download size={12} /> Export all
        </button>
      </div>
    </div>,
    document.body,
  );

  return (
    <>
      <button
        ref={btnRef}
        className={`dopesheet-tool-btn ${open ? 'active' : ''}`}
        title="Keyframe presets: save selected keyframes and reuse them on other clips"
        onClick={toggle}
      >
        <Bookmark size={12} />
        <span>Presets</span>
      </button>
      {menu}
    </>
  );
}