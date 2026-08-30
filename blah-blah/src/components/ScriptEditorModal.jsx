import { useState } from 'react';
import { X, Check, Save, FileCode, Sparkles } from 'lucide-react';
 
const SNIPPET_TEMPLATES = {
  floatBounce: {
    name: 'Float & Rock (MotionTween)',
    code: `export default class FloatAndBounce {
  static props = {
    amplitude: { type: 'number', default: 35, min: 0, max: 200, step: 1 },
    duration: { type: 'number', default: 1.2, min: 0.1, max: 10, step: 0.1 },
    rotationAngle: { type: 'number', default: 12, min: -180, max: 180, step: 1 },
  };
 
  onStart({ transform, tween, props }) {
    // Smooth Yoyo float on Y axis
    tween.to(transform.position, { y: -props.amplitude }, {
      duration: props.duration,
      ease: 'inOutSine',
      loop: 'yoyo'
    });
 
    // Rocking rotation
    tween.to(transform, { rotation: props.rotationAngle }, {
      duration: props.duration * 1.4,
      ease: 'inOutSine',
      loop: 'yoyo'
    });
  }
}`
  },
  bounceEnter: {
    name: 'Bounce Entrance (Ease.OutBounce)',
    code: `export default class BounceEnter {
  static props = {
    dropDistance: { type: 'number', default: 180, min: 0, max: 800, step: 10 },
    bounceDuration: { type: 'number', default: 0.9, min: 0.2, max: 5, step: 0.1 },
    targetScale: { type: 'number', default: 1.0, min: 0.1, max: 3, step: 0.05 },
  };
 
  onStart({ transform, tween, props }) {
    transform.position.y -= props.dropDistance;
    transform.scale.x = 0.2;
    transform.scale.y = 0.2;
 
    tween.to(transform.position, { y: 0 }, { duration: props.bounceDuration, ease: 'outBounce' });
    tween.to(transform.scale, { scale: props.targetScale }, { duration: props.bounceDuration, ease: 'outBack' });
  }
}`
  },
  pulseScale: {
    name: 'Breathing Pulse Scale',
    code: `export default class PulseScale {
  static props = {
    maxScale: { type: 'number', default: 1.25, min: 0.5, max: 3, step: 0.05 },
    pulseSpeed: { type: 'number', default: 0.6, min: 0.1, max: 5, step: 0.1 },
  };
 
  onStart({ transform, tween, props }) {
    tween.to(transform.scale, { scale: props.maxScale }, {
      duration: props.pulseSpeed,
      ease: 'inOutQuad',
      loop: 'yoyo'
    });
  }
}`
  },
  mathWave: {
    name: 'Trig Wave (Motion Canvas style)',
    code: `export default class MathWave {
  static props = {
    frequency: { type: 'number', default: 3.5, min: 0.1, max: 20, step: 0.1 },
    amplitude: { type: 'number', default: 30.0, min: 0, max: 200, step: 1 },
    spinSpeed: { type: 'number', default: 60.0, min: -360, max: 360, step: 5 },
  };
 
  onUpdate({ transform, time, props }) {
    transform.position.y += Math.sin(time * props.frequency) * props.amplitude;
    transform.position.x += Math.cos(time * (props.frequency * 0.5)) * (props.amplitude * 0.5);
    transform.rotation += (1 / 60) * props.spinSpeed;
  }
}`
  },
  glassCard: {
    name: 'Glassmorphic Card (React, no JSX)',
    code: `// Plain JavaScript, no JSX: h(tag, props, children) is shorthand for
// React.createElement(tag, props, children).
export default function GlassCard({
  title = "BLAHBLAH STUDIO",
  badge = "REACT COMPONENT",
  accentColor = "#6366f1"
}) {
  return h('div', {
    style: {
      padding: '24px 36px',
      background: 'rgba(15, 23, 42, 0.8)',
      backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      borderRadius: '20px',
      boxShadow: '0 12px 40px ' + accentColor + '44',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      fontFamily: 'Inter, sans-serif'
    }
  }, [
    h('span', {
      key: 'badge',
      style: {
        background: accentColor,
        color: '#ffffff',
        padding: '6px 14px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: '800',
        letterSpacing: '0.05em'
      }
    }, badge),
    h('h2', {
      key: 'title',
      style: {
        margin: 0,
        color: '#ffffff',
        fontSize: '24px',
        fontWeight: '800'
      }
    }, title)
  ]);
}
 
GlassCard.props = {
  title: { type: 'string', default: 'BLAHBLAH STUDIO' },
  badge: { type: 'string', default: 'REACT COMPONENT' },
  accentColor: { type: 'color', default: '#6366f1' },
};`
  },
  neonTitle: {
    name: 'Kinetic Neon Title (React, no JSX)',
    code: `// Plain JavaScript, no JSX: h(tag, props, children) is shorthand for
// React.createElement(tag, props, children).
export default function NeonTitle({
  text = "NEXT-GEN VIDEO",
  glowColor = "#38bdf8",
  fontSize = 44
}) {
  return h('div', {
    style: {
      fontSize: fontSize + 'px',
      fontWeight: '900',
      color: '#ffffff',
      fontFamily: 'Inter, sans-serif',
      textShadow: '0 0 25px ' + glowColor + ', 0 0 50px ' + glowColor,
      letterSpacing: '0.04em',
      textAlign: 'center'
    }
  }, text);
}
 
NeonTitle.props = {
  text: { type: 'string', default: 'NEXT-GEN VIDEO' },
  glowColor: { type: 'color', default: '#38bdf8' },
  fontSize: { type: 'number', default: 44, min: 12, max: 120, step: 2 }
};`
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
  const [name, setName] = useState(() => script.name || 'NewScript.js');
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
      if (key === 'glassCard' && !name.endsWith('.jsx')) {
        setName('GlassCard.jsx');
      } else if (key === 'neonTitle' && !name.endsWith('.jsx')) {
        setName('NeonTitle.jsx');
      }
    }
  };
 
  const isJsx = name.endsWith('.jsx') || code.includes('return') || code.includes('<div');
 
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card script-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            {isJsx ? <Sparkles size={18} className="text-cyan" /> : <FileCode size={18} className="text-emerald" />}
            <div className="script-title-edit">
              <input
                type="text"
                className="script-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="MyComponent.js"
              />
              <span className="script-badge">
                {isJsx ? 'React Component (no JSX)' : 'JavaScript Motion Script'}
              </span>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
 
        <div className="modal-body script-modal-body">
          <div className="script-toolbar">
            <span className="script-hint">
              Define <code>static props = &#123; speed: 2.5 &#125;</code> to auto-expose interactive controls in the Inspector! For visual components, use <code>h(tag, props, children)</code> instead of JSX (no build step here, so angle-bracket tags aren't supported).
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
                <option value="floatBounce">Float & Rock (MotionTween)</option>
                <option value="bounceEnter">Bounce Drop (OutBounce)</option>
                <option value="pulseScale">Breathing Pulse</option>
                <option value="mathWave">Trig Wave (Motion Canvas)</option>
                <option value="glassCard">Glassmorphic Card (React, no JSX)</option>
                <option value="neonTitle">Kinetic Neon Title (React, no JSX)</option>
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
              <span>{saved ? 'Saved & Compiled!' : 'Save & Compile Code'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
 