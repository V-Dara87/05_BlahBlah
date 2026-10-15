import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Check, Save, FileCode, AlertCircle } from 'lucide-react';
import { detectScriptKind, getScriptError, isScriptBundlePending } from '../../engine/scriptRunner';
import {
  countScriptErrors,
  errorLinesForScript,
  explainErrorText,
  parseErrorBlocks,
} from '../../engine/scriptErrorInfo';
import './script-editor-modal.css';
 
// Per-kind display metadata for the editor header badge (see detectScriptKind).
const SCRIPT_KIND_META = {
  react: { label: 'React Component' },
  canvas: { label: 'Canvas Component' },
  motion: { label: 'JavaScript Motion Script' },
};
const scriptKindLabel = (kind) => SCRIPT_KIND_META[kind]?.label || 'Script';
 
/** Height of one editor line in px — must match .script-gutter-line / the textarea's line-height. */
const LINE_HEIGHT_PX = 18;
 
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
  const [baseline, setBaseline] = useState(() => ({
    code: script.code || '',
    name: script.name || 'NewScript.jsx',
  }));
  const [code, setCode] = useState(baseline.code);
  const [name, setName] = useState(baseline.name);
 
  // 'idle' | 'saving' | 'ok' | { error: string }
  const [saveStatus, setSaveStatus] = useState('idle');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const textareaRef = useRef(null);
  const gutterRef = useRef(null);
 
  // Dirty = the working copy differs from the last saved values. Backdrop, X,
  // Cancel and Esc all route through requestClose, which only closes
  // immediately when nothing would be lost.
  const dirty = code !== baseline.code || name !== baseline.name;
 
  // Mirrors the current working copy so an in-flight save can tell whether the
  // user kept typing while it compiled (see handleSave). It is written from the
  // change handlers below — the only places code/name change — rather than
  // during render.
  const latestRef = useRef({ code, name });
 
  // Any edit clears the previous save outcome: the button goes back to
  // "Save & Compile Code" and the stale red compile box is hidden.
  const handleCodeChange = useCallback((value) => {
    latestRef.current = { ...latestRef.current, code: value };
    setCode(value);
    setSaveStatus('idle');
  }, []);
  const handleNameChange = useCallback((value) => {
    latestRef.current = { ...latestRef.current, name: value };
    setName(value);
    setSaveStatus('idle');
  }, []);
 
  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);
 
  /**
   * Turn whatever the host returned into a definite pass/fail. `onSaveScript`
   * returns the precompile result (usePrefabScriptActions.handleSaveScript);
   * when a host returns nothing, fall back to polling the compile caches for
   * up to ~2s so the status is still real rather than assumed.
   */
  const settleCompile = useCallback(async (result) => {
    if (result && typeof result.ok === 'boolean') {
      if (result.ok) {
        const err = getScriptError(code);
        return err ? { error: err } : { ok: true };
      }
      return { error: result.error || getScriptError(code) || 'Compilation failed.' };
    }
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const err = getScriptError(code);
      if (err) return { error: err };
      if (!isScriptBundlePending(code)) return { ok: true };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return getScriptError(code) ? { error: getScriptError(code) } : { ok: true };
  }, [code]);
 
  const handleSave = useCallback(async () => {
    setSaveStatus('saving');
    const saved = { code, name };
    let result;
    try {
      result = await onSaveScript(script.id, { name, code });
    } catch (err) {
      // The save itself failed (the disk write threw), so the working copy
      // really is still unsaved — stay dirty and report it.
      setSaveStatus({ error: err?.message || String(err) });
      return;
    }
    // The file is on disk as soon as onSaveScript resolves: it writes first and
    // compiles afterwards. Move the baseline NOW, even when the compile failed,
    // so closing does not ask "Discard unsaved changes?" for code that WAS
    // saved. A compile error is still shown in the red box below.
    setBaseline(saved);
    const outcome = await settleCompile(result);
    // If the user kept editing while the compile ran, the status stays 'idle'
    // and the next save decides.
    if (latestRef.current.code !== saved.code || latestRef.current.name !== saved.name) return;
    setSaveStatus(outcome.ok ? 'ok' : { error: outcome.error });
  }, [onSaveScript, script.id, name, code, settleCompile]);
 
  // Keyboard: Ctrl/Cmd+S saves, Esc closes (through the dirty check). A
  // document listener is used so the shortcuts work no matter which control
  // inside the modal has focus.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [requestClose, handleSave]);
 
  /** Tab inserts two spaces instead of moving focus out of the editor. */
  const handleTabKey = useCallback((e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.target;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = `${code.slice(0, start)}  ${code.slice(end)}`;
    handleCodeChange(next);
    // Restore the caret after the inserted spaces, once React has painted.
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = start + 2;
        textareaRef.current.selectionEnd = start + 2;
      }
    });
  }, [code, handleCodeChange]);
 
  // Line-number gutter: count the lines and keep the gutter scrolled in step
  // with the textarea. Rendered as plain text (no syntax highlighting).
  const lineCount = useMemo(() => code.split('\n').length, [code]);
  const syncGutterScroll = useCallback((e) => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.target.scrollTop;
  }, []);
 
  const kindLabel = scriptKindLabel(detectScriptKind(code));
  const errorMessage = saveStatus && typeof saveStatus === 'object' ? saveStatus.error : null;
  const errorCount = errorMessage ? countScriptErrors(errorMessage) : 0;
 
  // What to show in the red box and gutter. A save's result wins; otherwise a
  // script that already had an error when the editor opened shows it right
  // away, for as long as the text is still the code that error belongs to.
  const shownError = errorMessage || (code === baseline.code ? getScriptError(code) : null);
 
  // Lines the error points at (1-based line → messages), for the gutter. The
  // name used to match is the SAVED one: a rename that has not been saved yet
  // does not change what the compiler reported.
  const errorLines = useMemo(
    () => errorLinesForScript(shownError, baseline.name),
    [shownError, baseline.name],
  );
  const errorHint = useMemo(() => {
    if (!shownError) return null;
    return explainErrorText(parseErrorBlocks(shownError)[0]?.text) || explainErrorText(shownError);
  }, [shownError]);
 
  /** Put the caret at the start of a line and scroll it into view. */
  const jumpToLine = useCallback((line) => {
    const el = textareaRef.current;
    if (!el) return;
    const lines = code.split('\n');
    const target = Math.min(Math.max(1, line), lines.length);
    let offset = 0;
    for (let i = 0; i < target - 1; i += 1) offset += lines[i].length + 1;
    el.focus();
    // Caret only (no selection): the next keystroke must not replace the line.
    el.setSelectionRange(offset, offset);
    // Centre the line in the visible area; the gutter follows via onScroll.
    el.scrollTop = Math.max(0, (target - 1) * LINE_HEIGHT_PX - el.clientHeight / 2);
  }, [code]);
 
  // After a save that failed, take the user straight to the first bad line.
  const firstErrorLine = errorMessage && errorLines.size > 0 ? Math.min(...errorLines.keys()) : null;
  useEffect(() => {
    if (firstErrorLine !== null) jumpToLine(firstErrorLine);
    // Only when a new failed save lands — not on every keystroke/scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorMessage]);
 
  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div className="modal-card script-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <FileCode size={18} className="text-emerald" />
            <div className="script-title-edit">
              <input
                type="text"
                className="script-name-input"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="MyComponent.jsx"
              />
              <span className="script-badge">{kindLabel}</span>
              {dirty && <span className="script-dirty-dot" title="Unsaved changes">●</span>}
            </div>
          </div>
          <button className="close-btn" onClick={requestClose}>
            <X size={16} />
          </button>
        </div>
 
        <div className="modal-body script-modal-body">
          <div className="script-toolbar">
            <span className="script-hint">
              Define <code>static props = &#123; speed: num(2.5) &#125;</code> (or <code>speed: 2.5</code>) to auto-expose interactive controls in the Inspector — <code>num</code>, <code>bool</code>, <code>color</code>, <code>text</code>, <code>select</code>, <code>asset</code>, <code>font</code>, <code>button</code>, <code>group</code>, <code>row</code> and <code>Presets</code> are always in scope. Motion scripts use <code>onStart/onUpdate</code> with a <code>transform</code>; React components export a function returning JSX; canvas components export a class with <code>onMount/onUpdate</code>. JSX, TypeScript, and real <code>import</code> statements are all supported.
            </span>
          </div>
 
          <div className="script-editor-wrap">
            <div
              className="script-gutter"
              ref={gutterRef}
              aria-hidden="true"
              onClick={(e) => {
                // Clicking a red line number jumps the caret to that line.
                const row = e.target.closest('.script-gutter-line.has-error');
                if (row) jumpToLine(Number(row.textContent));
              }}
            >
              {Array.from({ length: lineCount }, (_, i) => {
                const messages = errorLines.get(i + 1);
                return (
                  <div
                    key={i}
                    className={`script-gutter-line${messages ? ' has-error' : ''}`}
                    title={messages ? messages.join('\n') : undefined}
                  >
                    {i + 1}
                  </div>
                );
              })}
            </div>
            <textarea
              className="script-code-textarea"
              ref={textareaRef}
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              onKeyDown={handleTabKey}
              onScroll={syncGutterScroll}
              spellCheck={false}
            />
          </div>
 
          {shownError && (
            <div className="script-compile-error">
              <AlertCircle size={12} />
              <div className="script-compile-error-body">
                {errorHint && <div className="script-compile-error-hint">💡 {errorHint}</div>}
                <pre>{shownError}</pre>
              </div>
            </div>
          )}
 
          {confirmDiscard && (
            <div className="script-discard-bar">
              <span>Discard unsaved changes?</span>
              <div className="script-discard-actions">
                <button className="unity-btn unity-btn-secondary" onClick={() => setConfirmDiscard(false)}>
                  Keep editing
                </button>
                <button className="unity-btn unity-btn-danger-text" onClick={onClose}>
                  Discard
                </button>
              </div>
            </div>
          )}
 
          <div className="script-footer">
            <button className="unity-btn unity-btn-secondary" onClick={requestClose}>
              Cancel
            </button>
            <button
              className="unity-btn unity-btn-primary"
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
            >
              {saveStatus === 'ok' ? <Check size={14} /> : <Save size={14} />}
              <span>
                {saveStatus === 'saving'
                  ? 'Compiling…'
                  : saveStatus === 'ok'
                    ? 'Saved ✓'
                    : errorMessage
                      ? `Saved — ${errorCount} error${errorCount === 1 ? '' : 's'}`
                      : 'Save & Compile Code'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
 