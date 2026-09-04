import { useState } from 'react';
import { X, Check, Save, FileCode } from 'lucide-react';
import { detectScriptKind } from '../engine/scriptRunner';

// Per-kind display metadata for the editor header badge (see detectScriptKind).
const SCRIPT_KIND_META = {
  react: { label: 'React Component' },
  canvas: { label: 'Canvas Component' },
  motion: { label: 'JavaScript Motion Script' },
};
const scriptKindLabel = (kind) => SCRIPT_KIND_META[kind]?.label || 'Script';
 
export function ScriptEditorModal({
  isOpen,
  onClose,
  script,
  onSaveScript
}) {
  if (!isOpen || !script) return null;
 
  return (
    <ScriptEditorModalContent
      onClose={onClose}
      script={script}
      onSaveScript={onSaveScript}
    />
  );
}
 
function ScriptEditorModalContent({
  onClose,
  script,
  onSaveScript
}) {
  const [code, setCode] = useState(() => script.code || '');
  const [name, setName] = useState(() => script.name || 'NewScript.jsx');
  const [saved, setSaved] = useState(false);
 
  const handleSave = () => {
    onSaveScript(script.id, {
      name,
      code
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
 
  const kindLabel = scriptKindLabel(detectScriptKind(code));
 
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card script-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <FileCode size={18} className="text-emerald" />
            <div className="script-title-edit">
              <input
                type="text"
                className="script-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="MyComponent.jsx"
              />
              <span className="script-badge">{kindLabel}</span>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
 
        <div className="modal-body script-modal-body">
          <div className="script-toolbar">
            <span className="script-hint">
              Define <code>static props = &#123; speed: 2.5 &#125;</code> to auto-expose interactive controls in the Inspector! Motion scripts use <code>onStart/onUpdate</code> with a <code>transform</code>; React components export a function returning JSX; canvas components export a class with <code>onMount/onUpdate</code>. JSX, TypeScript, and real <code>import</code> statements are all supported.
            </span>
          </div>
 
          <textarea
            className="script-code-textarea"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
          />
 
          <div className="script-footer">
            <button className="unity-btn unity-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="unity-btn unity-btn-primary" onClick={handleSave}>
              {saved ? <Check size={14} /> : <Save size={14} />}
              <span>{saved ? 'Saved & Compiled!' : 'Save & Compile Code'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
 