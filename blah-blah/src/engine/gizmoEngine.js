import { trackKeyFor, getFieldKeyframes, setKeyframe } from './keyframes.js';

/**
 * Reads a nested property by path (e.g. "nodes[0].x" or "center").
 */
export function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);
  let curr = obj;
  for (const part of parts) {
    if (curr == null) return undefined;
    curr = curr[part];
  }
  return curr;
}

/**
 * Immutably updates a nested property by path.
 */
export function setByPath(obj, path, value) {
  if (!path) return obj;
  const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);
  if (parts.length === 0) return obj;

  const clone = Array.isArray(obj) ? [...obj] : { ...obj };
  let curr = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextKey = parts[i + 1];
    const isNextArray = /^\d+$/.test(nextKey);
    const existing = curr[key];
    const nextVal = existing != null
      ? (Array.isArray(existing) ? [...existing] : { ...existing })
      : (isNextArray ? [] : {});
    curr[key] = nextVal;
    curr = nextVal;
  }
  curr[parts[parts.length - 1]] = value;
  return clone;
}

/**
 * Resolves all gizmo definitions for a given mounted script instance or schema.
 *
 * Supports:
 * 1. Dynamic method on instance: `instance.getGizmos({ props, time, canvasWidth, canvasHeight })`
 * 2. Static definition: `ScriptClass.gizmos`
 * 3. Property schema annotations: `static props = { pos: { gizmo: 'point' | { ... } } }`
 */
export function resolveScriptGizmos({
  instance = null,
  schema = {},
  props = {},
  canvasWidth = 1920,
  canvasHeight = 1080,
  time = 0,
}) {
  // 1. Dynamic hook: instance.getGizmos takes precedence
  if (instance && typeof instance.getGizmos === 'function') {
    try {
      const gizmos = instance.getGizmos({ props, time, canvasWidth, canvasHeight });
      if (Array.isArray(gizmos)) {
        return gizmos.map((g, idx) => normalizeGizmoDef(g, idx, props));
      }
    } catch (err) {
      console.warn('Error evaluating script getGizmos():', err);
    }
  }

  const result = [];

  // 2. Static gizmos on the class / prototype
  const ctor = instance?.constructor;
  const staticGizmos = ctor?.gizmos || instance?.gizmos;
  if (staticGizmos && typeof staticGizmos === 'object') {
    Object.entries(staticGizmos).forEach(([key, def], idx) => {
      const normalized = normalizeGizmoDef({ id: key, ...def }, idx, props);
      if (normalized) result.push(normalized);
    });
    if (result.length > 0) return result;
  }

  // 3. Infer from static props schema
  if (schema && typeof schema === 'object') {
    Object.entries(schema).forEach(([propName, fieldDef], idx) => {
      if (!fieldDef || !fieldDef.gizmo) return;
      const gizmoOpt = typeof fieldDef.gizmo === 'object' ? fieldDef.gizmo : {};
      const val = props[propName] ?? fieldDef.default;

      // Case 3a: point2d object { x, y }
      if (val && typeof val === 'object' && typeof val.x === 'number' && typeof val.y === 'number') {
        result.push(normalizeGizmoDef({
          id: propName,
          label: fieldDef.label || propName,
          x: val.x,
          y: val.y,
          propPath: propName,
          axes: gizmoOpt.axes || 'xy',
          size: gizmoOpt.size || 'normal',
          color: gizmoOpt.color,
          contextMenu: gizmoOpt.contextMenu,
        }, idx, props));
      }
      // Case 3b: Array of objects with x, y
      else if (Array.isArray(val)) {
        val.forEach((item, itemIdx) => {
          if (item && typeof item === 'object' && typeof item.x === 'number' && typeof item.y === 'number') {
            const itemAxes = item.axes || gizmoOpt.axes || 'xy';
            result.push(normalizeGizmoDef({
              id: item.id || `${propName}[${itemIdx}]`,
              label: item.title || item.label || `${propName} #${itemIdx + 1}`,
              x: item.x,
              y: item.y,
              width: item.width || 40,
              height: item.height || 40,
              propPath: `${propName}[${itemIdx}]`,
              axes: itemAxes,
              size: item.size || gizmoOpt.size || (item.width && item.width < 30 ? 'compact' : 'normal'),
              color: item.color || gizmoOpt.color,
              contextMenu: gizmoOpt.contextMenu || item.contextMenu,
            }, idx * 100 + itemIdx, props));
          }
        });
      }
      // Case 3c: Number field with 1D axis constraint
      else if (typeof val === 'number' && gizmoOpt.axis) {
        const isX = gizmoOpt.axis === 'x';
        result.push(normalizeGizmoDef({
          id: propName,
          label: fieldDef.label || propName,
          x: isX ? val : (gizmoOpt.originX ?? canvasWidth / 2),
          y: !isX ? val : (gizmoOpt.originY ?? canvasHeight / 2),
          propPath: propName,
          axes: isX ? 'x' : 'y',
          size: gizmoOpt.size || 'compact',
          color: gizmoOpt.color,
        }, idx, props));
      }
    });
  }

  return result;
}

/**
 * Normalizes a gizmo definition with defaults.
 */
function normalizeGizmoDef(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return {
    id: raw.id ? String(raw.id) : `gizmo-${index}`,
    label: raw.label || raw.id || `Item ${index + 1}`,
    x,
    y,
    width: Number.isFinite(raw.width) && raw.width > 0 ? raw.width : 28,
    height: Number.isFinite(raw.height) && raw.height > 0 ? raw.height : 28,
    axes: raw.axes === 'x' || raw.axes === 'y' ? raw.axes : 'xy',
    size: raw.size === 'compact' || raw.size === 'large' ? raw.size : 'normal',
    color: raw.color || '#38bdf8', // Tailwind sky-400
    shape: raw.shape || 'circle',
    propPath: raw.propPath,
    onDrag: raw.onDrag,
    contextMenu: Array.isArray(raw.contextMenu) ? raw.contextMenu : null,
    target: raw.target || null,
  };
}

/**
 * Applies a position update to an entity's script component props.
 * Supports auto-keying (when autoKeyEnabled is true or keyframes already exist).
 */
export function updateGizmoProperty({
  entity,
  scriptId,
  gizmo,
  newX,
  newY,
  dx = 0,
  dy = 0,
  autoKeyEnabled = false,
  currentTime = 0,
  fps = 30,
  instance = null,
}) {
  if (!entity || !scriptId) return null;

  // Custom onDrag hook if defined on gizmo
  if (typeof gizmo.onDrag === 'function') {
    try {
      gizmo.onDrag({ x: newX, y: newY, dx, dy });
    } catch (err) {
      console.warn('Error in gizmo.onDrag handler:', err);
    }
  }

  // If there's an instance method like `onGizmoDrag` or `setProp`
  if (instance && typeof instance.onGizmoDrag === 'function') {
    try {
      instance.onGizmoDrag({ id: gizmo.id, x: newX, y: newY, dx, dy, propPath: gizmo.propPath });
    } catch (err) {
      console.warn('Error in instance.onGizmoDrag:', err);
    }
  }

  if (!gizmo.propPath) return null;

  const scriptComp = entity.components?.find((c) => (c.type === 'ScriptComponent' || c.type === 'Script' || c.type === 'MonoBehaviour') && c.scriptId === scriptId)
    || entity.components?.find((c) => c.scriptId === scriptId);
  if (!scriptComp) return null;

  const currentProps = scriptComp.props || {};
  const currentVal = getByPath(currentProps, gizmo.propPath);

  let updatedVal;
  if (typeof gizmo.getValue === 'function') {
    updatedVal = gizmo.getValue({ x: newX, y: newY, dx, dy, currentVal, currentProps });
  } else if (typeof currentVal === 'number') {
    // 1D slider property
    updatedVal = gizmo.axes === 'x' ? newX : newY;
  } else if (currentVal && typeof currentVal === 'object') {
    // 2D Point or Struct
    updatedVal = { ...currentVal };
    if (gizmo.axes === 'x' || gizmo.axes === 'xy') updatedVal.x = newX;
    if (gizmo.axes === 'y' || gizmo.axes === 'xy') updatedVal.y = newY;
  } else {
    // Default to object with x, y
    updatedVal = { x: newX, y: newY };
  }

  const updatedProps = setByPath(currentProps, gizmo.propPath, updatedVal);

  // Keyframing evaluation
  const localTime = Math.max(0, currentTime - (entity.startTime || 0));
  const snapToFrame = (t) => Math.round(t * fps) / fps;
  const snappedTime = snapToFrame(localTime);
  const trackKey = trackKeyFor(scriptComp);

  let keyframesSnapshot = entity.keyframes || {};
  let keyframesChanged = false;

  // Base property name (e.g. for "points[0]" base name is "points")
  const rootPropName = gizmo.propPath.split(/[.[\]]/)[0];
  const kfs = getFieldKeyframes(entity, trackKey, rootPropName);
  const existingAtTime = kfs.find((k) => Math.abs(k.time - snappedTime) < 1 / (fps * 2));

  if (autoKeyEnabled || existingAtTime) {
    // Save full root prop into keyframe
    const rootVal = updatedProps[rootPropName];
    keyframesSnapshot = setKeyframe(entity, trackKey, rootPropName, snappedTime, rootVal);
    keyframesChanged = true;
  }

  const newComponents = entity.components.map((c) => {
    if (c === scriptComp) {
      return { ...c, props: updatedProps };
    }
    return c;
  });

  const patch = { components: newComponents };
  if (keyframesChanged) {
    patch.keyframes = keyframesSnapshot;
  }

  return patch;
}
