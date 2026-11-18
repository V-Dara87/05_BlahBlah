import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getFieldKeyframes, evaluateField, setKeyframeCurve, moveKeyframesDelta,
  DEFAULT_CP1, DEFAULT_CP2,
} from '../../engine/keyframes';
import {
  segmentHandles, handleToControlPoint, linkedHandleControlPoint, snapControlPoint, sampleSegment,
  curveExtent, shiftKeyframeValues, niceStep, stepDecimals,
} from '../../engine/keyframeGraph';
import { readCssValue, subscribeThemeChanges } from '../../services/themeSettings';

/**
 * GraphView — the Dopesheet's curve (graph) view, Spine 2D / Blender style.
 *
 * Every visible numeric parameter is drawn as a real curve: time on X, the
 * parameter's value on Y. You can
 *   - drag keyframe points in time AND value (all selected keys move together),
 *   - drag the two bezier handles of a selected key to reshape the easing of the
 *     segment next to it (the same cp1/cp2 the Curves tab edits). With
 *     `linkHandles` on (Spine style) the handle on the other side of the key
 *     moves too, mirrored through the key so the curve stays smooth there,
 *   - box-select keys, click empty space to clear + seek, double-click a curve to
 *     add a key, right-click a key for the Dopesheet's key menu.
 * View: Ctrl+wheel zooms time (shared with the Dopesheet), plain wheel zooms
 * the value axis around the cursor, Shift+wheel scrolls time, Alt+wheel pans
 * the value axis, middle-drag pans both. `fitToken` (re)frames all curves.
 *
 * It is a viewport canvas: the Dopesheet's lane scroller provides the horizontal
 * scroll (so the ruler stays aligned) and this canvas is `position: sticky`, so
 * it only ever paints what is on screen, however long the clip is.
 *
 * Writes go back through `onCommitKeyframes(keyframes)` — one whole new
 * `entity.keyframes` object, coalesced to at most one per animation frame while
 * dragging. The playhead is drawn by the parent as a DOM overlay so playback
 * never repaints this canvas.
 */

const KEY_R = 4.5;
const KEY_HIT = 9;
const HANDLE_R = 3.5;
const HANDLE_HIT = 10;
const CURVE_HIT = 8;
const DRAG_THRESHOLD = 3;
const MONO_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function readPalette() {
  return {
    bg: readCssValue('--unity-darkest', '#191919'),
    grid: readCssValue('--unity-border-light', '#3e3e3e'),
    dim: readCssValue('--unity-text-dim', '#6e6e6e'),
    muted: readCssValue('--unity-text-muted', '#999999'),
    selected: readCssValue('--unity-accent-amber', '#f59e0b'),
    danger: readCssValue('--unity-accent-red', '#ef4444'),
    mono: readCssValue('--font-mono', MONO_FALLBACK),
  };
}

function useThemeRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(
    () => subscribeThemeChanges(() => {
      requestAnimationFrame(() => setRevision((n) => n + 1));
    }),
    [],
  );
  return revision;
}

/** value <-> display mapping for one curve (identity, or 0..1 over its key range). */
function makeMap(lo, span, normalized) {
  return normalized
    ? { toDisp: (v) => (v - lo) / span, fromDisp: (d) => d * span + lo }
    : { toDisp: (v) => v, fromDisp: (d) => d };
}

/**
 * One entry per drawn curve. In Normalize mode a curve's scale comes from its
 * own key range; `frozen` (id -> { lo, span }) pins those scales while a key is
 * being dragged, otherwise the curve would re-normalise under the cursor and the
 * point being dragged could never leave the top/bottom edge.
 */
function buildModel(entity, curves, normalized, frozen) {
  const model = [];
  for (const c of curves) {
    const kfs = getFieldKeyframes(entity, c.trackKey, c.fieldName);
    if (kfs.length === 0) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (const k of kfs) {
      if (k.value < lo) lo = k.value;
      if (k.value > hi) hi = k.value;
    }
    let span = hi - lo > 1e-9 ? hi - lo : 1;
    const pinned = frozen?.get(c.id);
    if (pinned) {
      lo = pinned.lo;
      span = pinned.span;
    }
    model.push({ ...c, kfs, lo, span, ...makeMap(lo, span, normalized) });
  }
  return model;
}

function computeFit(model) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of model) {
    const ext = curveExtent(m.kfs);
    lo = Math.min(lo, m.toDisp(ext.min), m.toDisp(ext.max));
    hi = Math.max(hi, m.toDisp(ext.min), m.toDisp(ext.max));
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: -0.1, hi: 1.1 };
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.12;
  return { lo: lo - pad, hi: hi + pad };
}

export function GraphView({
  entity,
  curves,
  selectedKeyIds,
  normalized,
  pixelsPerSecond,
  clipDuration,
  gridStep,
  scrollRef,
  contentWidth,
  fitToken,
  autoFitOnCurveChange = true,
  linkHandles = false,
  snapToFrame,
  onSelectKeys,
  onCommitKeyframes,
  onSeekLocal,
  onAddKey,
  onKeyContextMenu,
  onKeyActivated,
  onZoomTime,
}) {
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scrollLeft, setScrollLeft] = useState(0);
  const [view, setView] = useState({ lo: -0.1, hi: 1.1 });
  const [hover, setHover] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [frozen, setFrozen] = useState(null);
  const themeRevision = useThemeRevision();
  const palette = useMemo(() => readPalette(), [themeRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  const keyframes = entity?.keyframes;
  const curvesSig = curves.map((c) => c.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => buildModel(entity, curves, normalized, frozen), [keyframes, curvesSig, normalized, frozen]);

  // Everything the pointer handlers read lives in one ref, refreshed every
  // render, so they never act on a stale closure.
  const latest = useRef(null);
  latest.current = {
    entity, model, view, size, scrollLeft, pixelsPerSecond, normalized, selectedKeyIds,
    snapToFrame, clipDuration, linkHandles,
    cb: { onSelectKeys, onCommitKeyframes, onSeekLocal, onAddKey, onKeyContextMenu, onKeyActivated, onZoomTime },
  };

  // --- viewport size + horizontal scroll, both owned by the Dopesheet's scroller ---
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return undefined;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const onScroll = () => setScrollLeft(el.scrollLeft);
    measure();
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    } else {
      window.addEventListener('resize', measure);
    }
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, [scrollRef]);

  // --- framing: on mount, on Fit, when Normalize flips, and (optionally) when the curve set changes ---
  const fitRef = useRef(null);
  fitRef.current = () => setView(computeFit(latest.current.model));
  useEffect(() => {
    fitRef.current();
  }, [fitToken, normalized]);
  const prevSigRef = useRef(curvesSig);
  useEffect(() => {
    if (prevSigRef.current === curvesSig) return;
    prevSigRef.current = curvesSig;
    if (autoFitOnCurveChange) fitRef.current();
  }, [curvesSig, autoFitOnCurveChange]);
  // First keyframes ever appearing in an empty graph: frame them.
  const hadCurvesRef = useRef(model.length > 0);
  useEffect(() => {
    if (!hadCurvesRef.current && model.length > 0) fitRef.current();
    hadCurvesRef.current = model.length > 0;
  }, [model.length]);

  // --- coordinate helpers (read the latest state) ---
  const xOf = (t) => t * latest.current.pixelsPerSecond - latest.current.scrollLeft;
  const tOf = (x) => (x + latest.current.scrollLeft) / latest.current.pixelsPerSecond;
  const yOf = (d) => {
    const { view: v, size: s } = latest.current;
    return s.h - ((d - v.lo) / (v.hi - v.lo)) * s.h;
  };
  const dOf = (y) => {
    const { view: v, size: s } = latest.current;
    return v.lo + (1 - y / s.h) * (v.hi - v.lo);
  };

  // --- hit testing: handles of selected keys, then keys ---
  const hitTest = (px, py) => {
    const L = latest.current;
    let bestKey = null;
    let bestKeyD = Infinity;
    let bestHandle = null;
    let bestHandleD = Infinity;
    for (const m of L.model) {
      const n = m.kfs.length;
      for (let i = 0; i < n; i++) {
        const k = m.kfs[i];
        const kx = xOf(k.time);
        if (kx < -30 || kx > L.size.w + 30) continue;
        const isSel = L.selectedKeyIds.has(k.id);
        const d = Math.hypot(px - kx, py - yOf(m.toDisp(k.value))) - (isSel ? 0.5 : 0);
        if (d <= KEY_HIT && d <= bestKeyD) {
          bestKeyD = d;
          bestKey = { type: 'key', curve: m, index: i, key: k };
        }
        if (!isSel) continue;
        if (i < n - 1) {
          const h = segmentHandles(k, m.kfs[i + 1]).out;
          const hd = Math.hypot(px - xOf(h.time), py - yOf(m.toDisp(h.value)));
          if (hd <= HANDLE_HIT && hd < bestHandleD) {
            bestHandleD = hd;
            bestHandle = { type: 'handle', curve: m, index: i, which: 'out', key: k };
          }
        }
        if (i > 0) {
          const a = m.kfs[i - 1];
          const h = segmentHandles(a, k).in;
          const hd = Math.hypot(px - xOf(h.time), py - yOf(m.toDisp(h.value)));
          if (hd <= HANDLE_HIT && hd < bestHandleD) {
            bestHandleD = hd;
            bestHandle = { type: 'handle', curve: m, index: i - 1, which: 'in', key: a };
          }
        }
      }
    }
    if (bestHandle && (!bestKey || bestHandleD < bestKeyD)) return bestHandle;
    return bestKey;
  };

  const localPoint = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // --- commit coalescing: at most one entity update per animation frame ---
  const pendingRef = useRef(null);
  const rafRef = useRef(0);
  const flushPending = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next) latest.current.cb.onCommitKeyframes?.(next);
  }, []);
  const scheduleCommit = useCallback((next) => {
    pendingRef.current = next;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) latest.current.cb.onCommitKeyframes?.(pending);
      });
    }
  }, []);
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const trackWindowDrag = (onMove, onUp) => {
    const up = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onUp(ev);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // --- drag: keyframe points (time + value, whole selection) ---
  const startKeyDrag = (e, hit) => {
    const L = latest.current;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const keyId = hit.key.id;
    let ids = new Set(L.selectedKeyIds);
    if (additive) {
      if (ids.has(keyId)) {
        ids.delete(keyId);
        L.cb.onSelectKeys?.(ids);
        return;
      }
      ids.add(keyId);
      L.cb.onSelectKeys?.(ids);
    } else if (!ids.has(keyId)) {
      ids = new Set([keyId]);
      L.cb.onSelectKeys?.(ids);
    }
    L.cb.onKeyActivated?.();

    const initial = L.entity;
    if (!initial?.keyframes) return;
    const normalizedAtStart = L.normalized;
    const spanById = new Map(L.model.map((m) => [m.id, m.span]));
    const rangeAtStart = L.view.hi - L.view.lo;
    const heightAtStart = L.size.h || 1;
    const idOf = (tk, fn) => `${tk}::${fn}`;

    let minTime = Infinity;
    for (const tk of Object.keys(initial.keyframes)) {
      for (const fn of Object.keys(initial.keyframes[tk] || {})) {
        for (const k of initial.keyframes[tk][fn] || []) {
          if (ids.has(k.id) && k.time < minTime) minTime = k.time;
        }
      }
    }
    if (!Number.isFinite(minTime)) minTime = hit.key.time;

    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    setDragging({ kind: 'key', keyId });
    setFrozen(new Map(L.model.map((m) => [m.id, { lo: m.lo, span: m.span }])));

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
      moved = true;
      const cur = latest.current;
      let dt = cur.snapToFrame(dx / cur.pixelsPerSecond);
      if (minTime + dt < 0) dt = -minTime;
      const dDisp = (-dy / heightAtStart) * rangeAtStart;
      // Only curves that are on screen take the value change; each moves by its own scale.
      const deltaFor = (tk, fn) => {
        const span = spanById.get(idOf(tk, fn));
        if (span === undefined) return 0;
        return normalizedAtStart ? dDisp * span : dDisp;
      };
      const shifted = { ...initial, keyframes: shiftKeyframeValues(initial, ids, deltaFor) };
      scheduleCommit(moveKeyframesDelta(shifted, ids, dt, cur.snapToFrame));
    };
    trackWindowDrag(onMove, () => {
      flushPending();
      setDragging(null);
      setFrozen(null);
      if (!moved && !additive && ids.size > 1) latest.current.cb.onSelectKeys?.(new Set([keyId]));
    });
  };

  // --- drag: a bezier handle (reshapes the segment's easing) ---
  const startHandleDrag = (e, hit) => {
    const L = latest.current;
    const initial = L.entity;
    const m = hit.curve;
    const a = m.kfs[hit.index];
    const b = m.kfs[hit.index + 1];
    if (!initial || !a || !b) return;
    const { fromDisp } = makeMap(m.lo, m.span, L.normalized);
    setDragging({ kind: 'handle', keyId: a.id, which: hit.which });

    // Linked handles: the key both handles hang off, and the neighbouring segment
    // that owns the opposite one (previous segment for an 'out' drag, next for 'in').
    // It is missing on the first / last key, where there is nothing to mirror.
    const sharedIdx = hit.which === 'out' ? hit.index : hit.index + 1;
    const anchor = m.kfs[sharedIdx];
    const oppWhich = hit.which === 'out' ? 'in' : 'out';
    const oppA = hit.which === 'out' ? m.kfs[sharedIdx - 1] : m.kfs[sharedIdx];
    const oppB = hit.which === 'out' ? m.kfs[sharedIdx] : m.kfs[sharedIdx + 1];
    const linked = Boolean(L.linkHandles && anchor && oppA && oppB);

    const onMove = (ev) => {
      const p = localPoint(ev);
      let cp = handleToControlPoint(a, b, hit.which, tOf(p.x), fromDisp(dOf(p.y)));
      if (ev.shiftKey) cp = snapControlPoint(cp);
      const cp1 = hit.which === 'out' ? cp : (a.cp1 || DEFAULT_CP1);
      const cp2 = hit.which === 'in' ? cp : (a.cp2 || DEFAULT_CP2);
      let next = setKeyframeCurve(initial, m.trackKey, m.fieldName, a.id, cp1, cp2);
      if (linked) {
        // Mirror from where the handle really ended up (after clamping / snapping).
        const dragged = segmentHandles({ ...a, cp1, cp2 }, b)[hit.which];
        const ocp = linkedHandleControlPoint(oppA, oppB, oppWhich, anchor, dragged);
        const o1 = oppWhich === 'out' ? ocp : (oppA.cp1 || DEFAULT_CP1);
        const o2 = oppWhich === 'in' ? ocp : (oppA.cp2 || DEFAULT_CP2);
        next = setKeyframeCurve({ ...initial, keyframes: next }, m.trackKey, m.fieldName, oppA.id, o1, o2);
      }
      scheduleCommit(next);
    };
    trackWindowDrag(onMove, () => {
      flushPending();
      setDragging(null);
    });
  };

  // --- drag: box select on empty space (a plain click clears + seeks) ---
  const startMarquee = (e, start) => {
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive ? new Set(latest.current.selectedKeyIds) : new Set();
    let moved = false;
    const onMove = (ev) => {
      const p = localPoint(ev);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) > DRAG_THRESHOLD) moved = true;
      if (!moved) return;
      const r = {
        x0: Math.min(start.x, p.x), x1: Math.max(start.x, p.x),
        y0: Math.min(start.y, p.y), y1: Math.max(start.y, p.y),
      };
      setMarquee(r);
      const hits = new Set(base);
      for (const m of latest.current.model) {
        for (const k of m.kfs) {
          const kx = xOf(k.time);
          const ky = yOf(m.toDisp(k.value));
          if (kx >= r.x0 && kx <= r.x1 && ky >= r.y0 && ky <= r.y1) hits.add(k.id);
        }
      }
      latest.current.cb.onSelectKeys?.(hits);
    };
    trackWindowDrag(onMove, () => {
      setMarquee(null);
      if (!moved && !additive) {
        const cur = latest.current;
        cur.cb.onSelectKeys?.(new Set());
        const t = Math.min(cur.clipDuration, Math.max(0, cur.snapToFrame(tOf(start.x))));
        cur.cb.onSeekLocal?.(t);
      }
    });
  };

  // --- drag: middle mouse pans value axis + time ---
  const startPan = (e) => {
    const L = latest.current;
    const startView = L.view;
    const startScroll = scrollRef?.current?.scrollLeft || 0;
    const startX = e.clientX;
    const startY = e.clientY;
    const range = startView.hi - startView.lo;
    const h = L.size.h || 1;
    const onMove = (ev) => {
      const shift = ((ev.clientY - startY) / h) * range;
      setView({ lo: startView.lo + shift, hi: startView.hi + shift });
      if (scrollRef?.current) scrollRef.current.scrollLeft = Math.max(0, startScroll - (ev.clientX - startX));
    };
    trackWindowDrag(onMove, () => {});
  };

  const handlePointerDown = (e) => {
    if (e.button === 1) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const p = localPoint(e);
    const hit = hitTest(p.x, p.y);
    if (hit?.type === 'handle') startHandleDrag(e, hit);
    else if (hit?.type === 'key') startKeyDrag(e, hit);
    else startMarquee(e, p);
  };

  const handlePointerMove = (e) => {
    if (dragging) return;
    const p = localPoint(e);
    const hit = hitTest(p.x, p.y);
    const next = hit
      ? { kind: hit.type, keyId: hit.key.id, which: hit.which, curveId: hit.curve.id }
      : null;
    setHover((prev) => {
      if (prev === next) return prev;
      if (prev && next && prev.kind === next.kind && prev.keyId === next.keyId && prev.which === next.which) return prev;
      return next;
    });
    if (canvasRef.current) {
      canvasRef.current.style.cursor = !hit ? 'default' : hit.type === 'handle' ? 'crosshair' : 'grab';
    }
  };

  const handleDoubleClick = (e) => {
    const p = localPoint(e);
    if (hitTest(p.x, p.y)) return;
    const L = latest.current;
    const t = Math.min(L.clipDuration, Math.max(0, L.snapToFrame(tOf(p.x))));
    let best = null;
    let bestD = CURVE_HIT;
    for (const m of L.model) {
      const v = evaluateField(L.entity, m.trackKey, m.fieldName, t);
      if (typeof v !== 'number') continue;
      const d = Math.abs(yOf(m.toDisp(v)) - p.y);
      if (d <= bestD) {
        bestD = d;
        best = { m, v };
      }
    }
    if (best) L.cb.onAddKey?.(best.m.trackKey, best.m.fieldName, t, best.v);
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    const p = localPoint(e);
    const hit = hitTest(p.x, p.y);
    if (!hit) return;
    const L = latest.current;
    if (!L.selectedKeyIds.has(hit.key.id)) L.cb.onSelectKeys?.(new Set([hit.key.id]));
    L.cb.onKeyContextMenu?.({
      x: e.clientX,
      y: e.clientY,
      trackKey: hit.curve.trackKey,
      fieldName: hit.curve.fieldName,
      fieldLabel: hit.curve.label,
      keyframe: hit.key,
    });
  };

  // Wheel needs a NON-passive native listener (React's onWheel is passive, so it
  // could not stop the page from scrolling / zooming).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (e) => {
      const L = latest.current;
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        L.cb.onZoomTime?.(e);
        return;
      }
      if (e.shiftKey) {
        if (scrollRef?.current) scrollRef.current.scrollLeft += e.deltaY || e.deltaX;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const range = L.view.hi - L.view.lo;
      if (e.altKey) {
        const shift = (e.deltaY / (L.size.h || 1)) * range;
        setView({ lo: L.view.lo + shift, hi: L.view.hi + shift });
        return;
      }
      const factor = Math.exp(e.deltaY * 0.0015);
      const anchor = L.view.lo + (1 - y / (L.size.h || 1)) * range;
      setView({
        lo: anchor - (anchor - L.view.lo) * factor,
        hi: anchor + (L.view.hi - anchor) * factor,
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [scrollRef]);

  // --- painting ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const W = size.w;
    const H = size.h;
    if (!canvas || W <= 0 || H <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pal = palette;
    const range = view.hi - view.lo;
    const px = (t) => t * pixelsPerSecond - scrollLeft;
    const py = (d) => H - ((d - view.lo) / range) * H;

    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);

    // Vertical time grid (matches the ruler's major ticks)
    if (gridStep > 0) {
      ctx.strokeStyle = pal.grid;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = Math.floor(scrollLeft / (gridStep * pixelsPerSecond)); ; i++) {
        const x = Math.round(px(i * gridStep)) + 0.5;
        if (x > W) break;
        if (x < 0) continue;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Horizontal value grid (the labels are painted last, on top of the curves)
    const step = niceStep(range, Math.max(2, H / 56));
    const decimals = stepDecimals(step);
    const valueLabels = [];
    for (let v = Math.ceil(view.lo / step) * step, guard = 0; v <= view.hi && guard < 400; v += step, guard++) {
      const y = Math.round(py(v)) + 0.5;
      const isZero = Math.abs(v) < step * 1e-6;
      ctx.strokeStyle = pal.grid;
      ctx.globalAlpha = isZero ? 0.85 : 0.35;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      valueLabels.push({ text: (isZero ? 0 : v).toFixed(decimals), y });
    }

    // Past the end of the clip
    const endX = px(clipDuration);
    if (endX < W) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
      ctx.fillRect(Math.max(0, endX), 0, W - Math.max(0, endX), H);
      if (endX >= 0) {
        ctx.strokeStyle = pal.danger;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(Math.round(endX) + 0.5, 0);
        ctx.lineTo(Math.round(endX) + 0.5, H);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Curves: those holding a selected key last, so they sit on top
    const hasSel = (m) => m.kfs.some((k) => selectedKeyIds.has(k.id));
    const ordered = [...model].sort((a, b) => Number(hasSel(a)) - Number(hasSel(b)));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const m of ordered) {
      const emphasised = hasSel(m);
      const first = m.kfs[0];
      const last = m.kfs[m.kfs.length - 1];
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = emphasised ? 1 : 0.78;
      ctx.lineWidth = emphasised ? 2.2 : 1.6;
      ctx.beginPath();
      ctx.moveTo(-2, py(m.toDisp(first.value)));
      ctx.lineTo(px(first.time), py(m.toDisp(first.value)));
      for (let i = 0; i < m.kfs.length - 1; i++) {
        const a = m.kfs[i];
        const b = m.kfs[i + 1];
        const xa = px(a.time);
        const xb = px(b.time);
        if (xb < -4 || xa > W + 4) {
          ctx.lineTo(xb, py(m.toDisp(b.value)));
          continue;
        }
        const steps = Math.min(120, Math.max(8, Math.ceil((xb - xa) / 3)));
        for (const s of sampleSegment(a, b, steps)) ctx.lineTo(px(s.time), py(m.toDisp(s.value)));
      }
      ctx.lineTo(W + 2, py(m.toDisp(last.value)));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Handles of selected keys (drawn under the key points)
    const target = dragging || hover;
    const drawHandle = (m, a, which, anchor, h) => {
      const hx = px(h.time);
      const hy = py(m.toDisp(h.value));
      const hot = target && target.kind === 'handle' && target.keyId === a.id && target.which === which;
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px(anchor.time), py(m.toDisp(anchor.value)));
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = hot ? '#ffffff' : m.color;
      ctx.strokeStyle = pal.bg;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hx, hy, hot ? HANDLE_R + 1.5 : HANDLE_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    for (const m of model) {
      const n = m.kfs.length;
      for (let i = 0; i < n; i++) {
        const k = m.kfs[i];
        if (!selectedKeyIds.has(k.id)) continue;
        if (i < n - 1) drawHandle(m, k, 'out', k, segmentHandles(k, m.kfs[i + 1]).out);
        if (i > 0) drawHandle(m, m.kfs[i - 1], 'in', k, segmentHandles(m.kfs[i - 1], k).in);
      }
    }

    // Keyframe points
    for (const m of model) {
      for (const k of m.kfs) {
        const x = px(k.time);
        if (x < -10 || x > W + 10) continue;
        const y = py(m.toDisp(k.value));
        const isSel = selectedKeyIds.has(k.id);
        const hot = target && target.kind === 'key' && target.keyId === k.id;
        const r = isSel || hot ? KEY_R + 1 : KEY_R;
        ctx.fillStyle = isSel ? pal.selected : m.color;
        ctx.strokeStyle = isSel ? '#ffffff' : pal.bg;
        ctx.lineWidth = isSel ? 1.5 : 1.25;
        ctx.beginPath();
        ctx.moveTo(x, y - r - 1);
        ctx.lineTo(x + r + 1, y);
        ctx.lineTo(x, y + r + 1);
        ctx.lineTo(x - r - 1, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Value-axis labels: on top of the curves, with a background halo so they stay readable
    ctx.font = `10px ${pal.mono}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = pal.bg;
    ctx.fillStyle = pal.muted;
    for (const label of valueLabels) {
      ctx.strokeText(label.text, 4, label.y - 2);
      ctx.fillText(label.text, 4, label.y - 2);
    }

    // Value tag for the hovered / dragged item
    if (target) {
      const m = model.find((c) => c.kfs.some((k) => k.id === target.keyId));
      const k = m?.kfs.find((kk) => kk.id === target.keyId);
      if (m && k) {
        let text;
        let ax;
        let ay;
        if (target.kind === 'handle') {
          const i = m.kfs.indexOf(k);
          const nextKey = m.kfs[i + 1];
          if (nextKey) {
            const cp = target.which === 'out' ? (k.cp1 || DEFAULT_CP1) : (k.cp2 || DEFAULT_CP2);
            const h = segmentHandles(k, nextKey)[target.which];
            text = `${cp.x.toFixed(2)}, ${cp.y.toFixed(2)}`;
            ax = px(h.time);
            ay = py(m.toDisp(h.value));
          }
        } else {
          text = `${m.label}  ${k.time.toFixed(2)}s  ${k.value.toFixed(2)}`;
          ax = px(k.time);
          ay = py(m.toDisp(k.value));
        }
        if (text) {
          ctx.font = `600 10px ${pal.mono}`;
          const w = ctx.measureText(text).width + 12;
          const h = 17;
          let tx = ax + 12;
          if (tx + w > W - 2) tx = ax - 12 - w;
          let ty = ay - h - 8;
          if (ty < 2) ty = ay + 10;
          ctx.globalAlpha = 0.94;
          ctx.fillStyle = pal.bg;
          ctx.strokeStyle = pal.grid;
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(tx, ty, w, h, 4);
          else ctx.rect(tx, ty, w, h);
          ctx.fill();
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = m.color;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, tx + 6, ty + h / 2 + 0.5);
        }
      }
    }

    // Marquee
    if (marquee) {
      ctx.fillStyle = 'rgba(143, 227, 224, 0.18)';
      ctx.strokeStyle = '#8fe3e0';
      ctx.lineWidth = 1;
      ctx.fillRect(marquee.x0, marquee.y0, marquee.x1 - marquee.x0, marquee.y1 - marquee.y0);
      ctx.strokeRect(marquee.x0 + 0.5, marquee.y0 + 0.5, marquee.x1 - marquee.x0, marquee.y1 - marquee.y0);
    }
  }, [
    size, scrollLeft, view, model, selectedKeyIds, hover, dragging, marquee, palette,
    pixelsPerSecond, clipDuration, gridStep,
  ]);

  const innerWidth = Math.max(contentWidth || 0, size.w);

  return (
    <div className="dopesheet-graph-inner" style={{ width: `${innerWidth}px` }}>
      <div className="dopesheet-graph-sticky" style={{ width: size.w, height: size.h }}>
        <canvas
          ref={canvasRef}
          className="dopesheet-graph-canvas"
          style={{ width: size.w, height: size.h }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
        />
      </div>
    </div>
  );
}