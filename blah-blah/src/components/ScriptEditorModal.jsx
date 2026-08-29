import { useState } from 'react';
import { X, Check, Save, FileCode } from 'lucide-react';

const SNIPPET_TEMPLATES = {
  floatBounce: {
    name: 'Float & Rock (BlahTween)',
    code: `using UnityEngine;
using BlahTween;

public class FloatAndBounce : MonoBehaviour
{
    public float amplitude = 35f;
    public float duration = 1.0f;
    public float rotationAngle = 12f;

    void Start()
    {
        // Smooth continuous Yoyo float with OutSine easing
        transform.DOMoveY(-amplitude, duration)
            .SetEase(Ease.InOutSine)
            .SetLoops(-1, LoopType.Yoyo);

        // Gentle rocking rotation
        transform.DORotate(rotationAngle, duration * 1.4f)
            .SetEase(Ease.InOutSine)
            .SetLoops(-1, LoopType.Yoyo);
    }

    void Update()
    {
        // Custom math update if needed
    }
}`
  },
  bounceEnter: {
    name: 'Bounce Entrance (Ease.OutBounce)',
    code: `using UnityEngine;
using BlahTween;

public class BounceEnter : MonoBehaviour
{
    public float dropDistance = 180f;
    public float bounceDuration = 0.9f;

    void Start()
    {
        transform.position.y -= dropDistance;
        transform.scale.x = 0.3f;
        transform.scale.y = 0.3f;

        transform.DOMoveY(0, bounceDuration).SetEase(Ease.OutBounce);
        transform.DOScale(1.0f, bounceDuration).SetEase(Ease.OutBack);
    }
}`
  },
  pulseScale: {
    name: 'Breathing Pulse Scale',
    code: `using UnityEngine;
using BlahTween;

public class PulseScale : MonoBehaviour
{
    public float maxScale = 1.3f;
    public float pulseSpeed = 0.5f;

    void Start()
    {
        transform.DOScale(maxScale, pulseSpeed)
            .SetEase(Ease.InOutQuad)
            .SetLoops(-1, LoopType.Yoyo);
    }
}`
  },
  punchShake: {
    name: 'Elastic Punch & Shake',
    code: `using UnityEngine;
using BlahTween;

public class PunchShake : MonoBehaviour
{
    public float punchStrength = 40f;
    public float duration = 0.8f;

    void Start()
    {
        transform.DOPunchPosition(punchStrength, duration);
    }
}`
  },
  mathWave: {
    name: 'Trig Wave (Motion Canvas style)',
    code: `using UnityEngine;

public class MathWave : MonoBehaviour
{
    public float frequency = 3.5f;
    public float amplitude = 30.0f;
    public float spinSpeed = 60.0f;

    void Update()
    {
        transform.position.y += Mathf.Sin(Time.time * frequency) * amplitude;
        transform.position.x += Mathf.Cos(Time.time * (frequency * 0.5f)) * (amplitude * 0.5f);
        transform.rotation += Time.deltaTime * spinSpeed;
    }
}`
  }
};

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
  const [name, setName] = useState(() => script.name || 'NewScript.cs');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    onSaveScript(script.id, {
      name,
      code
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleInsertTemplate = (key) => {
    const tmpl = SNIPPET_TEMPLATES[key];
    if (tmpl) {
      setCode(tmpl.code);
    }
  };

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
                placeholder="ScriptName.cs"
              />
              <span className="script-badge">C# MonoBehaviour</span>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body script-modal-body">
          <div className="script-toolbar">
            <span className="script-hint">
              Define public fields (e.g. <code>public float speed = 2.5f;</code>) to auto-expose them in the Unity Inspector!
            </span>
            <div className="snippet-dropdown-group">
              <span className="snippet-label">Insert Snippet:</span>
              <select
                className="unity-select-sm"
                onChange={(e) => {
                  if (e.target.value) handleInsertTemplate(e.target.value);
                  e.target.value = '';
                }}
                defaultValue=""
              >
                <option value="" disabled>Choose template...</option>
                <option value="floatBounce">Float & Rock (BlahTween)</option>
                <option value="bounceEnter">Bounce Drop (OutBounce)</option>
                <option value="pulseScale">Breathing Pulse</option>
                <option value="punchShake">Elastic Punch & Shake</option>
                <option value="mathWave">Trig Wave (Motion Canvas)</option>
              </select>
            </div>
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
              <span>{saved ? 'Saved & Compiled!' : 'Save & Compile Script'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
