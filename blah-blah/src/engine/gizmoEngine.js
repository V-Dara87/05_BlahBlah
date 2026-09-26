import { trackKeyFor, getFieldKeyframes, setKeyframe } from './keyframes.js';

/**
 * Parse a property path into segments. Supported forms:
 *
 *   a.b             object key
 *   a[0].b          array index
 *   a[foo]          object / array key access (legacy `a.foo`)
 *   a[id=n3].b      KEY SELECTOR — the array item whose `id` === 'n3'.
 *
 * The key-selector form is what keeps a gizmo pointing at the SAME item when a
 * script re-orders its struct[] list between renders (auto-layout order vs.
 * stored order), which index paths cannot express.
 */
function parsePropPath(path) {
  const rawParts = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(path ?? '')) {
    if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    if (ch === '.' && depth === 0) {
      if (cur) rawParts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) rawParts.push(cur);

  return rawParts.map((part) => {
    const m = part.match(/^([^[\]]+)(?:\[([^\]]*)\])?$/);
    if (!m) return { key: part, kind: 'key' };
    const key = m[1];
    if (m[2] === undefined) return { key, kind: 'key' };
    const inner = m[2];
    const eq = inner.indexOf('=');
    if (eq !== -1) {
      return { key, kind: 'match', prop: inner.slice(0, eq).trim(), value: inner.slice(eq + 1).trim() };
    }
    if (/^\d+$/.test(inner)) return { key, kind: 'index', index: Number(inner) };
    return { key, kind: 'key', childKey: inner };
  });
}

/** Index of the array item matched by a key selector, or -1. */
function selectorIndex(arr, prop, value) {
  if (!Array.isArray(arr)) return -1;
  return arr.findIndex((item) => item && String(item[prop]) === String(value));
}

/**
 * Reads a nested property by path (e.g. "nodes[0].x", "nodes[id=n3].x" or
 * "center").
 */
export function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  let curr = obj;
  for (const seg of parsePropPath(path)) {
    if (curr == null) return undefined;
    if (seg.kind === 'key') {
      curr = seg.childKey !== undefined ? curr[seg.key]?.[seg.childKey] : curr[seg.key];
    } else if (seg.kind === 'index') {
      curr = curr[seg.key]?.[seg.index];
    } else {
      const arr = curr[seg.key];
      const idx = selectorIndex(arr, seg.prop, seg.value);
      curr = idx < 0 ? undefined : arr[idx];
    }
  }
  return curr;
}

/**
 * Rewrites a path's key selectors into concrete array indices, using `obj` to
 * resolve them. Returns null when a selector cannot be matched — the caller
 * must then leave the object untouched rather than write to the wrong item.
 */
function resolveIndexPath(obj, path) {
  const out = [];
  let curr = obj;
  for (const seg of parsePropPath(path)) {
    if (seg.kind === 'match') {
      const arr = curr?.[seg.key];
      const idx = selectorIndex(arr, seg.prop, seg.value);
      if (idx < 0) return null;
      out.push(`${seg.key}[${idx}]`);
      curr = arr[idx];
    } else if (seg.kind === 'index') {
      out.push(`${seg.key}[${seg.index}]`);
      curr = curr?.[seg.key]?.[seg.index];
    } else {
      out.push(seg.childKey !== undefined ? `${seg.key}.${seg.childKey}` : seg.key);
      curr = seg.childKey !== undefined ? curr?.[seg.key]?.[seg.childKey] : curr?.[seg.key];
    }
  }
  return out.join('.');
}

/**
 * Immutably updates a nested property by path. Key selectors
 * (`nodes[id=n3].x`) are resolved against `obj` first; if no item matches, the
 * object is returned unchanged.
 */
export function setByPath(obj, path, value) {
  if (!path) return obj;
  const resolvedPath = resolveIndexPath(obj, path);
  if (!resolvedPath) return obj;
  const parts = resolvedPath.replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);
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
 * `propName[id=abc]` when the item carries a selector-safe `id`, else
 * `propName[idx]`. A key selector must survive the path parser, so ids
 * containing `]`, `=` or `.` fall back to the index.
 */
function arrayItemPropPath(propName, item, itemIdx) {
  const rawId = item && item.id;
  const id = rawId == null ? '' : String(rawId);
  if (id && /^[A-Za-z0-9_-]+$/.test(id)) return `${propName}[id=${id}]`;
  return `${propName}[${itemIdx}]`;
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
  if (schema) {
    const entries = Array.isArray(schema)
      ? schema.map((field) => [field.name || field.id, field])
      : Object.entries(schema);

    entries.forEach(([propName, fieldDef], idx) => {
      if (!fieldDef) return;
      // Either explicitly marked with gizmo, or a struct/point with x and y fields
      const isStructWithXY = fieldDef.type === 'struct' && (fieldDef.fields?.x || fieldDef.fields?.y);
      const hasGizmo = Boolean(fieldDef.gizmo || isStructWithXY);
      if (!hasGizmo) return;

      const gizmoOpt = typeof fieldDef.gizmo === 'object' ? fieldDef.gizmo : {};
      const val = props[propName] ?? fieldDef.defaultVal ?? fieldDef.default;

      // Case 3a: point2d object or struct { x, y, ... }
      if (val && typeof val === 'object' && typeof val.x === 'number' && typeof val.y === 'number') {
        result.push(normalizeGizmoDef({
          id: propName,
          label: fieldDef.label || propName,
          x: val.x,
          y: val.y,
          propPath: propName,
          axes: gizmoOpt.axes || 'xy',
          space: gizmoOpt.space || 'local',
          rotation: gizmoOpt.rotation || val.rotation || 0,
          origin: gizmoOpt.origin || 'center',
          size: gizmoOpt.size || 'normal',
          color: gizmoOpt.color,
          contextMenu: gizmoOpt.contextMenu,
        }, idx, props));
      }
      // Case 3b: Array of objects with x, y (struct[] or point array)
      else if (Array.isArray(val)) {
        val.forEach((item, itemIdx) => {
          if (item && typeof item === 'object' && typeof item.x === 'number' && typeof item.y === 'number') {
            const itemAxes = item.axes || gizmoOpt.axes || 'xy';
            result.push(normalizeGizmoDef({
              id: item.id || `${propName}[${itemIdx}]`,
              label: item.title || item.label || `${fieldDef.label || propName} #${itemIdx + 1}`,
              x: item.x,
              y: item.y,
              width: item.width || 40,
              height: item.height || 40,
              // Prefer the item's own id as a STABLE selector over its current
              // index: a script that re-orders `struct[]` between renders (an
              // auto-layout pass vs. the stored order) would otherwise make an
              // index path target a different item after the reorder, so a
              // gizmo drag silently overwrote the wrong entry.
              propPath: arrayItemPropPath(propName, item, itemIdx),
              axes: itemAxes,
              space: item.space || gizmoOpt.space || 'local',
              rotation: item.rotation || gizmoOpt.rotation || 0,
              origin: item.origin || gizmoOpt.origin || 'center',
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
          x: isX ? val : (gizmoOpt.originX ?? 0),
          y: !isX ? val : (gizmoOpt.originY ?? 0),
          propPath: propName,
          axes: isX ? 'x' : 'y',
          space: gizmoOpt.space || 'local',
          size: gizmoOpt.size || 'compact',
          color: gizmoOpt.color,
        }, idx, props));
      }
    });
  }

  return result;
}

/**
 * Resolves the effective origin in canvas pixels for a gizmo.
 */
export function getGizmoOrigin(origin = 'center', canvasWidth = 1920, canvasHeight = 1080) {
  if (origin && typeof origin === 'object' && Number.isFinite(origin.x) && Number.isFinite(origin.y)) {
    return { x: origin.x, y: origin.y };
  }
  if (origin === 'top-left') {
    return { x: 0, y: 0 };
  }
  // Default is center
  return { x: canvasWidth / 2, y: canvasHeight / 2 };
}

/**
 * Converts a gizmo's position into canvas pixel coordinates (0..canvasWidth, 0..canvasHeight).
 */
export function gizmoToCanvasCoords(gizmo, canvasWidth = 1920, canvasHeight = 1080) {
  if (gizmo.space === 'local') {
    const origin = getGizmoOrigin(gizmo.origin, canvasWidth, canvasHeight);
    return {
      x: origin.x + gizmo.x,
      y: origin.y + gizmo.y,
    };
  }
  return { x: gizmo.x, y: gizmo.y };
}

/**
 * Converts canvas pixel coordinates to the gizmo's native coordinate space.
 */
export function canvasToGizmoCoords(canvasCoords, gizmo, canvasWidth = 1920, canvasHeight = 1080) {
  if (gizmo.space === 'local') {
    const origin = getGizmoOrigin(gizmo.origin, canvasWidth, canvasHeight);
    return {
      x: canvasCoords.x - origin.x,
      y: canvasCoords.y - origin.y,
    };
  }
  return { x: canvasCoords.x, y: canvasCoords.y };
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
    space: raw.space === 'global' ? 'global' : 'local',
    rotation: Number.isFinite(Number(raw.rotation)) ? Number(raw.rotation) : 0,
    origin: raw.origin || 'center',
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
