import { BlahTweenContext, BlahTween, Ease, LoopType } from './blahtween';

/**
 * Cache for compiled C# script functions to avoid recompiling with new Function() on every frame.
 */
const scriptFunctionCache = new Map();
const publicFieldsCache = new Map();

/**
 * Parses C# script code to extract public fields for the Unity Inspector.
 */
export function extractCSharpPublicFields(code) {
  if (!code) return [];
  if (publicFieldsCache.has(code)) {
    return publicFieldsCache.get(code);
  }

  const fields = [];
  const regex = /public\s+(float|int|string|bool|Color)\s+([a-zA-Z0-9_]+)\s*(?:=\s*([^;]+))?\s*;/g;
  let match;

  while ((match = regex.exec(code)) !== null) {
    const type = match[1];
    const name = match[2];
    const rawVal = match[3] ? match[3].trim() : undefined;

    let defaultVal;
    if (type === 'float' || type === 'int') {
      defaultVal = rawVal !== undefined ? parseFloat(rawVal.replace(/f|F/g, '')) : 0;
    } else if (type === 'bool') {
      defaultVal = rawVal !== undefined ? rawVal === 'true' : false;
    } else if (type === 'string') {
      defaultVal = rawVal !== undefined ? rawVal.replace(/^["']|["']$/g, '') : '';
    } else if (type === 'Color') {
      defaultVal = rawVal !== undefined ? rawVal.replace(/^["']|["']$/g, '') : '#ffffff';
    }

    fields.push({ name, type, defaultVal });
  }

  publicFieldsCache.set(code, fields);
  return fields;
}

/**
 * Unity Mathf helper object available inside C# MonoBehaviour scripts
 */
export const Mathf = {
  PI: Math.PI,
  Sin: (rad) => Math.sin(rad),
  Cos: (rad) => Math.cos(rad),
  Tan: (rad) => Math.tan(rad),
  Abs: (val) => Math.abs(val),
  Min: (...vals) => Math.min(...vals),
  Max: (...vals) => Math.max(...vals),
  Clamp: (val, min, max) => Math.max(min, Math.min(max, val)),
  Clamp01: (val) => Math.max(0, Math.min(1, val)),
  Lerp: (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t)),
  Floor: (val) => Math.floor(val),
  Ceil: (val) => Math.ceil(val),
  Round: (val) => Math.round(val),
  Sqrt: (val) => Math.sqrt(val),
  Pow: (b, e) => Math.pow(b, e),
};

const Vector2 = (x, y) => ({ x, y });
const Vector3 = (x, y, z = 0) => ({ x, y, z });

// Convert common C# keywords to JS friendly equivalents
const sanitizeCSharpToJS = (codeStr) => {
  return codeStr
    .replace(/(\d+(?:\.\d+)?)f\b/g, '$1')
    .replace(/\bDebug\.Log\b/g, 'console.log')
    .replace(/\bnew\s+Vector2/g, 'Vector2')
    .replace(/\bnew\s+Vector3/g, 'Vector3');
};

/**
 * Get or compile cached JavaScript function for a C# script.
 */
function getCompiledScript(scriptCode, publicKeys) {
  const cacheKey = `${scriptCode}__keys:${publicKeys.join(',')}`;
  if (scriptFunctionCache.has(cacheKey)) {
    return scriptFunctionCache.get(cacheKey);
  }

  const startMatch = scriptCode.match(/void\s+Start\s*\(\s*\)\s*\{([\s\S]*?)\n\s*\}/);
  const updateMatch = scriptCode.match(/void\s+Update\s*\(\s*\)\s*\{([\s\S]*?)\n\s*\}/);

  const startBody = startMatch ? startMatch[1] : '';
  const updateBody = updateMatch ? updateMatch[1] : '';

  const funcBody = `
    const { ${publicKeys.join(', ') || '_'} } = props;
    
    // Start() logic for tweens
    ${sanitizeCSharpToJS(startBody)}

    // Evaluate tweens first
    const tweened = this.tweenContext.evaluate(Time.time, {
      x: transform.position.x,
      y: transform.position.y,
      rotation: transform.rotation,
      scaleX: transform.scale.x,
      scaleY: transform.scale.y,
      opacity: transform.opacity
    });
    transform.position.x = tweened.x;
    transform.position.y = tweened.y;
    transform.rotation = tweened.rotation;
    transform.scale.x = tweened.scaleX;
    transform.scale.y = tweened.scaleY;
    transform.opacity = tweened.opacity;

    // Update() logic
    ${sanitizeCSharpToJS(updateBody)}

    return {
      x: transform.position.x,
      y: transform.position.y,
      rotation: transform.rotation,
      scaleX: transform.scale.x,
      scaleY: transform.scale.y,
      opacity: transform.opacity
    };
  `;

  const scriptFunc = new Function(
    'transform',
    'Time',
    'Mathf',
    'BlahTween',
    'Ease',
    'LoopType',
    'Vector2',
    'Vector3',
    'props',
    funcBody
  );

  scriptFunctionCache.set(cacheKey, scriptFunc);
  return scriptFunc;
}

/**
 * Transpiles and executes a C# MonoBehaviour script deterministically for the given clip time.
 */
export function executeCSharpMonoBehaviour({
  scriptCode,
  transform,
  localTime,
  clipDuration,
  publicValues = {},
}) {
  if (!scriptCode) return transform;

  try {
    const tweenContext = new BlahTweenContext({ ...transform });

    const Time = {
      time: localTime,
      deltaTime: 1 / 60,
      duration: clipDuration,
      progress: Math.min(1, Math.max(0, localTime / (clipDuration || 1))),
    };

    const transformProxy = {
      position: { x: transform.x, y: transform.y, z: 0 },
      rotation: transform.rotation || 0,
      scale: { x: transform.scaleX ?? 1, y: transform.scaleY ?? 1 },
      opacity: transform.opacity ?? 1,
      DOMove: (x, y, dur) => tweenContext.DOMove(x, y, dur),
      DOMoveX: (x, dur) => tweenContext.DOMoveX(x, dur),
      DOMoveY: (y, dur) => tweenContext.DOMoveY(y, dur),
      DORotate: (deg, dur) => tweenContext.DORotate(deg, dur),
      DOScale: (scale, dur) => tweenContext.DOScale(scale, dur),
      DOScaleX: (sx, dur) => tweenContext.DOScaleX(sx, dur),
      DOScaleY: (sy, dur) => tweenContext.DOScaleY(sy, dur),
      DOFade: (alpha, dur) => tweenContext.DOFade(alpha, dur),
      DOShakePosition: (intensity, dur) => tweenContext.DOShakePosition(intensity, dur),
      DOPunchPosition: (punch, dur) => tweenContext.DOPunchPosition(punch, dur),
    };

    const publicKeys = Object.keys(publicValues);
    const scriptFunc = getCompiledScript(scriptCode, publicKeys);

    const result = scriptFunc.call(
      { tweenContext },
      transformProxy,
      Time,
      Mathf,
      BlahTween,
      Ease,
      LoopType,
      Vector2,
      Vector3,
      publicValues
    );

    return {
      ...transform,
      x: result.x ?? transform.x,
      y: result.y ?? transform.y,
      rotation: result.rotation ?? transform.rotation,
      scaleX: result.scaleX ?? transform.scaleX,
      scaleY: result.scaleY ?? transform.scaleY,
      opacity: result.opacity ?? transform.opacity,
    };
  } catch (err) {
    console.warn('C# Script execution warning:', err);
    return transform;
  }
}
