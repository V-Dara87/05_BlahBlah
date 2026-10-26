/**
 * Box and pivot sizes for a layer, shared by the preview (OverlayLayer /
 * VideoLayer), the render pipeline and the exporter.
 *
 * Why this exists: 3D layers need a concrete box. `project3DLayer` maps the
 * layer's local pixel coordinates into screen space, so it has to know which
 * rectangle the projected quad covers (getLayerBox) and how large a normalized
 * pivot (pivotX/Y in -0.5..0.5) is in pixels (getPivotBase). When the preview
 * and the export each guessed these separately they disagreed, so a 3D layer
 * could be pivoted, clipped or warped differently in the two renderers.
 */

/** The preview's long-standing default pivot base for layers with no size. */
export const DEFAULT_PIVOT_BASE = 180;

/**
 * The size a normalized pivot (pivotX/Y in -0.5..0.5) is multiplied by, which
 * is NOT always the box the layer is rasterized into:
 *
 * - An authored size (a shape's width/height) is the pivot base.
 * - A canvas-kind script fills the frame, so the frame is its pivot base.
 * - Anything else (text, react scripts) has no authored size; the preview has
 *   always normalized its pivot against a 180px default, so keeping that here
 *   is what makes the same pivot value swing a layer by the same amount whether
 *   or not `is3D` is on.
 *
 * @param {object} entity
 * @param {object} options
 * @param {number} [options.frameWidth]
 * @param {number} [options.frameHeight]
 * @param {(comp: object) => ('canvas'|'react'|null)} [options.scriptKindOf]
 * @returns {{ width: number, height: number }}
 */
export function getPivotBase(entity, {
  frameWidth = 1920,
  frameHeight = 1080,
  scriptKindOf = null,
} = {}) {
  if (!entity) return { width: DEFAULT_PIVOT_BASE, height: DEFAULT_PIVOT_BASE };

  const comps = entity.components || [];
  const authoredWidth = comps.find((c) => c.width)?.width;
  const authoredHeight = comps.find((c) => c.height)?.height;
  if (authoredWidth && authoredHeight) {
    return { width: authoredWidth, height: authoredHeight };
  }

  const isCanvasClip =
    Boolean(scriptKindOf) &&
    comps.some(
      (c) => c.type === 'ScriptComponent' && c.enabled !== false && scriptKindOf(c) === 'canvas'
    );
  if (isCanvasClip) return { width: frameWidth, height: frameHeight };

  return { width: DEFAULT_PIVOT_BASE, height: DEFAULT_PIVOT_BASE };
}

/**
 * The rectangle a layer is rasterized into, and whose four corners the camera
 * projects into the preview's CSS `matrix3d` and the export's warp.
 *
 * - A video layer fills the whole frame.
 * - A shape layer is its authored width/height.
 * - Everything else (text, scripts, unknown) has no authored size and is
 *   centred on the frame, so the frame is the box it can safely be rasterized
 *   into. The projected homography is exact everywhere on the layer plane, so a
 *   larger box only costs memory — it never distorts.
 *
 * @param {object} entity
 * @param {object} options
 * @param {number} [options.frameWidth]  Project width in px.
 * @param {number} [options.frameHeight] Project height in px.
 * @param {boolean} [options.isVideo] Force the frame-sized video box.
 * @returns {{ width: number, height: number }}
 */
export function getLayerBox(entity, { frameWidth = 1920, frameHeight = 1080, isVideo = false } = {}) {
  const frame = { width: frameWidth, height: frameHeight };
  if (!entity) return frame;

  const comps = entity.components || [];
  const isVideoLayer =
    isVideo ||
    entity.type === 'video' ||
    entity.type === 'audio' ||
    comps.some((c) => c.type === 'VideoRenderer');
  if (isVideoLayer) return frame;

  const authoredWidth = comps.find((c) => c.width)?.width;
  const authoredHeight = comps.find((c) => c.height)?.height;
  if (authoredWidth && authoredHeight) {
    return { width: authoredWidth, height: authoredHeight };
  }

  return frame;
}
