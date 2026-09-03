/**
 * Entity Component System (ECS) & Prefab models for blahblah
 * Modern JavaScript & React Component Architecture
 */
 
/**
 * P0 #1/#2 — Renderer component factory.
 *
 * `EntityRenderer.jsx` is the single unified renderer (replacing the old
 * split SceneViewport / PreviewWindow components). It doesn't hardcode a
 * switch-per-type; instead every renderable component type is described by
 * a small descriptor created here, which EntityRenderer looks up by
 * `component.type`.
 *
 * Two kinds of renderer descriptors:
 *  - `dom`   — built-in DOM-based renderers (Text/Shape/Video/Audio/React).
 *              These already work today via inline JSX in EntityRenderer,
 *              so their descriptor is mostly a marker + metadata.
 *  - `canvas`— the new CanvasRenderer contract (P0 #2): arbitrary web tech
 *              (Three.js, raw Canvas/WebGL, GSAP, etc.) mounted into a
 *              plain <div> container, driven by absolute timeline time.
 *
 * This keeps "add a new renderer type" a one-place registration instead of
 * a hand-written branch duplicated across viewport components.
 */
export function createRendererComponent(type, config = {}) {
  return {
    type,
    kind: config.kind || 'dom', // 'dom' | 'canvas'
    ...config,
  };
}
 
export const RENDERER_REGISTRY = {
  TextRenderer: createRendererComponent('TextRenderer', { kind: 'dom', label: 'Text Component' }),
  ShapeRenderer: createRendererComponent('ShapeRenderer', { kind: 'dom', label: 'Shape Component' }),
  VideoRenderer: createRendererComponent('VideoRenderer', { kind: 'dom', label: 'Video Component' }),
  AudioSource: createRendererComponent('AudioSource', { kind: 'dom', label: 'Audio Component' }),
  ReactRenderer: createRendererComponent('ReactRenderer', { kind: 'dom', label: 'React Component' }),
  // P0 #2 — new component type for arbitrary web tech (Three.js, raw
  // Canvas/WebGL, etc). Contract:
  //   export default class MyThing {
  //     static props = { speed: { type: 'number', default: 1, min: 0, max: 10 } };
  //     onMount({ container, props, libs }) {}
  //     onUpdate({ container, time, frame, props }) {}
  //     onUnmount() {}
  //   }
  // `container` is a plain <div>. `libs` are injected globals (libs.THREE,
  // libs.gsap, ...) — the pragmatic first step for "support all web tech"
  // via CDN globals; swap for esbuild-wasm + ESM later if literal `import`
  // syntax is wanted (the component contract doesn't change either way).
  // `onUpdate` is driven by absolute timeline time (currentTime - startTime),
  // NOT wall-clock/rAF accumulation, so scrubbing and export stay deterministic.
  CanvasRenderer: createRendererComponent('CanvasRenderer', { kind: 'canvas', label: 'Canvas Component' }),
};
 
/**
 * Libraries injected into CanvasRenderer scripts as `libs.<Name>`.
 * Loaded lazily (see engine/canvasLibs.js) from CDN globals the first time
 * a CanvasRenderer component actually needs one, so most projects never
 * pay the cost of unused libraries.
 *
 * NOTE: not every library supports seeking to an arbitrary time cleanly
 * (some GSAP/Three.js patterns keep their own internal clock) — verify
 * seek-to-time behavior per library before assuming scrubbing looks correct.
 */
export const CANVAS_LIB_SOURCES = {
  THREE: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  gsap: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js',
};
 
export const DEFAULT_SCRIPTS = [
  {
    id: 'script-float-bounce',
    name: 'FloatAndBounce.js',
    description: 'Smooth floating Y motion with subtle rotation using MotionTween',
    code: `export default class FloatAndBounce {
  static props = {
    amplitude: { type: 'number', default: 35, min: 0, max: 200, step: 1 },
    duration: { type: 'number', default: 1.2, min: 0.1, max: 10, step: 0.1 },
    rotationAngle: { type: 'number', default: 10, min: -180, max: 180, step: 1 },
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
      duration: props.duration * 1.5,
      ease: 'inOutSine',
      loop: 'yoyo'
    });
  }
}`
  },
  {
    id: 'script-bounce-enter',
    name: 'BounceEnter.js',
    description: 'Dramatic bounce drop-in entrance animation',
    code: `export default class BounceEnter {
  static props = {
    dropDistance: { type: 'number', default: 180, min: 0, max: 800, step: 10 },
    bounceDuration: { type: 'number', default: 0.9, min: 0.2, max: 5, step: 0.1 },
    targetScale: { type: 'number', default: 1.0, min: 0.1, max: 3, step: 0.05 },
  };
 
  onStart({ transform, tween, props }) {
    // Drop in from top with elastic outBounce
    tween.from(transform.position, { y: -props.dropDistance }, {
      duration: props.bounceDuration,
      ease: 'outBounce'
    });
 
    // Scale pop-in
    tween.from(transform.scale, { scale: 0.2 }, {
      duration: props.bounceDuration,
      ease: 'outBack'
    });
  }
}`
  },
  {
    id: 'script-pulse-scale',
    name: 'PulseScale.js',
    description: 'Continuous rhythmic breathing pulse scale',
    code: `export default class PulseScale {
  static props = {
    maxScale: { type: 'number', default: 1.25, min: 0.5, max: 3, step: 0.05 },
    pulseSpeed: { type: 'number', default: 0.6, min: 0.1, max: 5, step: 0.1 },
  };
 
  onStart({ transform, tween, props }) {
    tween.to(transform.scale, { x: props.maxScale, y: props.maxScale }, {
      duration: props.pulseSpeed,
      ease: 'inOutQuad',
      loop: 'yoyo'
    });
  }
}`
  },
  {
    id: 'script-math-wave',
    name: 'MathWave.js',
    description: 'Motion Canvas style trigonometric waveform motion in onUpdate()',
    code: `export default class MathWave {
  static props = {
    frequency: { type: 'number', default: 3.0, min: 0.1, max: 20, step: 0.1 },
    amplitude: { type: 'number', default: 35.0, min: 0, max: 200, step: 1 },
    spinSpeed: { type: 'number', default: 45.0, min: -360, max: 360, step: 5 },
  };
 
  onUpdate({ transform, time, props }) {
    transform.position.y += Math.sin(time * props.frequency) * props.amplitude;
    transform.position.x += Math.cos(time * (props.frequency * 0.5)) * (props.amplitude * 0.4);
    transform.rotation += (1 / 60) * props.spinSpeed;
  }
}`
  },
  {
    id: 'script-glass-card',
    name: 'GlassCard.jsx',
    description: 'Rich React Component clip with backdrop blur and customizable props',
    code: `// Plain JavaScript, no JSX: h(tag, props, children) is shorthand for
// React.createElement(tag, props, children). Nest calls for nested
// elements; pass an array as children for multiple siblings.
export default function GlassCard({
  title = "BLAHBLAH STUDIO",
  badge = "MOTION ENGINE",
  accentColor = "#6366f1"
}) {
  return h('div', {
    style: {
      padding: '24px 36px',
      background: 'rgba(15, 23, 42, 0.75)',
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
        padding: '5px 12px',
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
        fontWeight: '800',
        letterSpacing: '-0.02em'
      }
    }, title)
  ]);
}
 
GlassCard.props = {
  title: { type: 'string', default: 'BLAHBLAH STUDIO' },
  badge: { type: 'string', default: 'MOTION ENGINE' },
  accentColor: { type: 'color', default: '#6366f1' },
};`
  },
  {
    id: 'script-canvas-orbit',
    name: 'CanvasOrbit.js',
    description: 'CanvasRenderer sample: raw <canvas> 2D orbiting dot, driven by absolute timeline time',
    code: `export default class CanvasOrbit {
  static props = {
    radius: { type: 'number', default: 80, min: 10, max: 400, step: 1 },
    speed: { type: 'number', default: 1, min: 0, max: 10, step: 0.1 },
    dotColor: { type: 'color', default: '#38bdf8' },
  };
 
  onMount({ container, props }) {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    canvas.style.display = 'block';
    container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }
 
  onUpdate({ time, props }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
 
    // Pure function of absolute timeline time -> deterministic scrubbing & export.
    const angle = time * props.speed;
    const x = w / 2 + Math.cos(angle) * props.radius;
    const y = h / 2 + Math.sin(angle) * props.radius;
 
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, props.radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.stroke();
 
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fillStyle = props.dotColor;
    ctx.fill();
  }
 
  onUnmount({ container }) {
    if (this.canvas) container.removeChild(this.canvas);
  }
}`
  }
];
 
// Alias for backward compatibility
export const DEFAULT_CSHARP_SCRIPTS = DEFAULT_SCRIPTS;
 
export const DEFAULT_PREFABS = [
  {
    id: 'prefab-neon-title',
    name: 'NeonTitle.prefab',
    type: 'text',
    components: [
      {
        type: 'Transform',
        x: 0,
        y: -40,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1
      },
      {
        type: 'TextRenderer',
        text: 'BLAHBLAH STUDIO',
        fontSize: 48,
        fontColor: '#ffffff',
        fontFamily: 'Inter',
        shadowColor: 'rgba(99, 102, 241, 0.8)',
        shadowBlur: 16
      },
      {
        type: 'ScriptComponent',
        scriptId: 'script-float-bounce',
        scriptName: 'FloatAndBounce.js',
        enabled: true,
        props: {
          amplitude: 30,
          duration: 1.2,
          rotationAngle: 8
        }
      }
    ]
  },
  {
    id: 'prefab-badge',
    name: 'GlowingBadge.prefab',
    type: 'shape',
    components: [
      {
        type: 'Transform',
        x: 0,
        y: 60,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1
      },
      {
        type: 'ShapeRenderer',
        shapeType: 'rounded-rect',
        width: 180,
        height: 48,
        color: '#4f46e5',
        strokeColor: '#38bdf8',
        strokeWidth: 2,
        borderRadius: 24
      },
      {
        type: 'TextRenderer',
        text: '⚡ MOTION ENGINE',
        fontSize: 14,
        fontColor: '#ffffff',
        fontFamily: 'Inter'
      },
      {
        type: 'ScriptComponent',
        scriptId: 'script-pulse-scale',
        scriptName: 'PulseScale.js',
        enabled: true,
        props: {
          maxScale: 1.15,
          pulseSpeed: 0.6
        }
      }
    ]
  },
  {
    id: 'prefab-glass-card',
    name: 'GlassCard.prefab',
    type: 'react',
    components: [
      {
        type: 'Transform',
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1
      },
      {
        type: 'ReactRenderer',
        scriptId: 'script-glass-card',
        scriptName: 'GlassCard.jsx',
        props: {
          title: 'BLAHBLAH STUDIO',
          badge: 'REACT COMPONENT',
          accentColor: '#6366f1'
        }
      },
      {
        type: 'ScriptComponent',
        scriptId: 'script-bounce-enter',
        scriptName: 'BounceEnter.js',
        enabled: true,
        props: {
          dropDistance: 160,
          bounceDuration: 0.9,
          targetScale: 1.0
        }
      }
    ]
  },
  {
    id: 'prefab-canvas-orbit',
    name: 'CanvasOrbit.prefab',
    type: 'canvas',
    components: [
      {
        type: 'Transform',
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1
      },
      {
        type: 'CanvasRenderer',
        scriptId: 'script-canvas-orbit',
        scriptName: 'CanvasOrbit.js',
        props: {
          radius: 80,
          speed: 1,
          dotColor: '#38bdf8'
        }
      }
    ]
  }
];
 
export function createDefaultTransform(overrides = {}) {
  return {
    type: 'Transform',
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    ...overrides
  };
}
 
export function createGameObject({
  name = 'GameObject',
  trackId = 'track-1',
  startTime = 0,
  duration = 6,
  type = 'video',
  components = [],
  src = '',
  color = '#6366f1'
}) {
  const hasTransform = components.some(c => c.type === 'Transform');
  const finalComponents = hasTransform ? [...components] : [createDefaultTransform(), ...components];
 
  return {
    id: `go-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    name,
    tag: 'Untagged',
    layer: 'Default',
    active: true,
    trackId,
    startTime,
    duration,
    type,
    src,
    color,
    components: finalComponents,
    linkGroupId: null, // when set, clips with the same groupId move together
  };
}