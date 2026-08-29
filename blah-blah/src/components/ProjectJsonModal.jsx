import { useState } from 'react';
import { Code, Copy, Check, CheckCircle2, AlertCircle, X, Sparkles } from 'lucide-react';

export function ProjectJsonModal({
  isOpen,
  onClose,
  projectState,
  onApplyProjectJson
}) {
  if (!isOpen) return null;

  return (
    <ProjectJsonModalContent
      onClose={onClose}
      projectState={projectState}
      onApplyProjectJson={onApplyProjectJson}
    />
  );
}

function ProjectJsonModalContent({
  onClose,
  projectState,
  onApplyProjectJson
}) {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(projectState, null, 2));
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = () => {
    try {
      const parsed = JSON.parse(jsonText);
      onApplyProjectJson(parsed);
      setError(null);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(`Invalid JSON syntax: ${err.message}`);
    }
  };

  const handleBeautify = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (err) {
      setError(`Cannot format invalid JSON: ${err.message}`);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card json-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <Code size={18} className="text-cyan" />
            <h3>Project Code (JSON / AI Schema)</h3>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body json-modal-body">
          <div className="json-toolbar">
            <span className="json-hint">
              Copy this JSON to prompt an AI (ChatGPT/Claude), or paste AI-generated project code and click Apply!
            </span>
            <div className="json-actions-row">
              <button className="unity-btn unity-btn-secondary btn-sm" onClick={handleBeautify}>
                Format JSON
              </button>
              <button className="unity-btn unity-btn-secondary btn-sm" onClick={handleCopy}>
                {copied ? <Check size={13} className="text-emerald" /> : <Copy size={13} />}
                <span>{copied ? 'Copied to Clipboard!' : 'Copy JSON'}</span>
              </button>
            </div>
          </div>

          <textarea
            className="json-code-textarea"
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            spellCheck={false}
          />

          {error && (
            <div className="json-error-banner">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="json-success-banner">
              <CheckCircle2 size={14} />
              <span>Project state updated successfully!</span>
            </div>
          )}

          <div className="json-footer">
            <button className="unity-btn unity-btn-primary full-width" onClick={handleApply}>
              <Sparkles size={14} />
              <span>Apply JSON to Project</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
