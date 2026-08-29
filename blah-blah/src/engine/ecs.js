/**
 * Entity Component System (ECS) & Prefab models for blahblah
 */

export const DEFAULT_CSHARP_SCRIPTS = [
  {
    id: 'script-float-bounce',
    name: 'FloatAndBounce.cs',
    description: 'Smooth floating Y motion with subtle rotation using BlahTween',
    code: `using UnityEngine;
using BlahTween;

public class FloatAndBounce : MonoBehaviour
{
    public float amplitude = 40f;
    public float duration = 1.2f;
    public float rotationAngle = 10f;

    void Start()
    {
        // Smooth Yoyo float with OutSine easing
        transform.DOMoveY(-amplitude, duration)
            .SetEase(Ease.InOutSine)
            .SetLoops(-1, LoopType.Yoyo);

        // Gentle rocking rotation
        transform.DORotate(rotationAngle, duration * 1.5f)
            .SetEase(Ease.InOutSine)
            .SetLoops(-1, LoopType.Yoyo);
    }

    void Update()
    {
        // Custom per-frame updates if needed
    }
}`
  },
  {
    id: 'script-bounce-enter',
    name: 'BounceEnter.cs',
    description: 'Dramatic bounce drop-in entrance animation',
    code: `using UnityEngine;
using BlahTween;

public class BounceEnter : MonoBehaviour
{
    public float dropDistance = 200f;
    public float bounceDuration = 1.0f;
    public float targetScale = 1.0f;

    void Start()
    {
        // Drop in from top with OutBounce
        transform.position.y -= dropDistance;
        transform.scale.x = 0.2f;
        transform.scale.y = 0.2f;

        transform.DOMoveY(0, bounceDuration).SetEase(Ease.OutBounce);
        transform.DOScale(targetScale, bounceDuration).SetEase(Ease.OutBack);
    }
}`
  },
  {
    id: 'script-pulse-scale',
    name: 'PulseScale.cs',
    description: 'Continuous rhythmic breathing pulse scale',
    code: `using UnityEngine;
using BlahTween;

public class PulseScale : MonoBehaviour
{
    public float maxScale = 1.25f;
    public float pulseSpeed = 0.5f;

    void Start()
    {
        transform.DOScale(maxScale, pulseSpeed)
            .SetEase(Ease.InOutQuad)
            .SetLoops(-1, LoopType.Yoyo);
    }
}`
  },
  {
    id: 'script-math-wave',
    name: 'MathWave.cs',
    description: 'Motion Canvas style trigonometric waveform motion in Update()',
    code: `using UnityEngine;

public class MathWave : MonoBehaviour
{
    public float frequency = 3.0f;
    public float amplitude = 35.0f;
    public float spinSpeed = 45.0f;

    void Update()
    {
        // Pure mathematical motion on each frame
        transform.position.y += Mathf.Sin(Time.time * frequency) * amplitude;
        transform.position.x += Mathf.Cos(Time.time * (frequency * 0.5f)) * (amplitude * 0.4f);
        transform.rotation += Time.deltaTime * spinSpeed;
    }
}`
  }
];

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
        type: 'MonoBehaviour',
        scriptId: 'script-float-bounce',
        scriptName: 'FloatAndBounce.cs',
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
        text: '⚡ MOTION CANVAS',
        fontSize: 14,
        fontColor: '#ffffff',
        fontFamily: 'Inter'
      },
      {
        type: 'MonoBehaviour',
        scriptId: 'script-pulse-scale',
        scriptName: 'PulseScale.cs',
        enabled: true,
        props: {
          maxScale: 1.15,
          pulseSpeed: 0.6
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
  trackId = 'track-v1',
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
    components: finalComponents
  };
}
