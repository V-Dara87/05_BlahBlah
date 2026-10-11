import { useLayoutEffect, useEffect, useRef } from 'react';
import { updateCanvasComponent, pruneCanvasComponents } from '../engine/canvasRunner';
import { isScriptComponent } from '../engine/ecs';
import { detectScriptKind } from '../engine/scriptRunner';
 
/**
 * Drives canvas-kind script components every frame: mounts on first
 * appearance, calls onUpdate with the absolute-timeline localTime every
 * tick, and unmounts/prunes once an entity or script leaves the active
 * window. Pulled out of EntityRenderer.jsx as its own hook — it owns the
 * canvasContainerRefs map (JSX attaches containers into it via a ref
 * callback keyed the same way this hook reads them) and the corresponding
 * unmount cleanup.
 *
 * FLICKER FIX: this must stay a `useLayoutEffect`, not a plain `useEffect`.
 * Passive effects run asynchronously *after* the browser has already
 * painted the current commit, so during playback (a rAF-driven
 * `currentTime` state update every frame) there's a real window where the
 * browser can paint before this effect's ctx.clearRect()/redraw calls run
 * for the new time — i.e. it briefly shows the *previous* frame's canvas
 * pixels before this effect catches up. That reads as flicker/glitching,
 * and gets worse the higher a script's `speed`-style prop is (more visual
 * change per frame makes the stale frame more noticeable). This is not a
 * bug in individual canvas scripts (they are pure functions of absolute
 * `time`, exactly per the P0 #2 contract) — it's the renderer's effect
 * timing. `useLayoutEffect` runs synchronously right after DOM mutations
 * but *before* the browser paints, so the canvas is fully redrawn for the
 * current `currentTime` before anything hits the screen — this is the fix
 * React's own docs recommend for any imperative canvas/DOM paint that's
 * driven by props/state (see
 * https://react.dev/reference/react/useLayoutEffect).
 */
export function useCanvasScriptDriver({ computedEntities, scripts, currentTime, fps, resolution, fallbackResolution, entities, mediaAssets }) {
  const canvasContainerRefs = useRef({});
 
  useLayoutEffect(() => {
    const activeMountKeys = [];
    computedEntities.forEach(({ entity, localTime }) => {
      for (const comp of entity.components || []) {
        if (!isScriptComponent(comp) || comp.enabled === false || !comp.scriptId) continue;
        const scriptDef = scripts.find((s) => s.id === comp.scriptId);
        if (!scriptDef || !scriptDef.code) continue;
        if (detectScriptKind(scriptDef.code) !== 'canvas') continue;
 
        const mountKey = `${entity.id}::${comp.scriptId}`;
        activeMountKeys.push(mountKey);
        const container = canvasContainerRefs.current[mountKey];
        if (!container) continue;
 
        updateCanvasComponent({
          entityId: entity.id,
          scriptId: comp.scriptId,
          scriptName: scriptDef.name,
          scriptCode: scriptDef.code,
          container,
          localTime,
          frame: Math.round(localTime * fps),
          fps,
          props: comp.props || {},
          allEntities: entities,
          allAssets: mediaAssets,
          duration: entity.duration ?? 5,
          startTime: entity.startTime ?? 0,
          // Project's real output resolution — the default a canvas
          // script receives as canvasWidth/canvasHeight unless it
          // overrides via its own static props (see canvasRunner.js).
          canvasWidth: resolution?.width > 0 ? resolution.width : fallbackResolution.width,
          canvasHeight: resolution?.height > 0 ? resolution.height : fallbackResolution.height,
        });
      }
    });
 
    pruneCanvasComponents(activeMountKeys);
  }, [computedEntities, scripts, currentTime, fps, resolution?.width, resolution?.height, entities, mediaAssets]);
 
  // Clean up canvas components when the owning component unmounts.
  useEffect(() => {
    return () => {
      pruneCanvasComponents([]);
    };
  }, []);
 
  return { canvasContainerRefs };
}
 