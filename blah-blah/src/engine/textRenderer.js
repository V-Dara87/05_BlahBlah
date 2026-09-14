/**
 * Shared TextRenderer presentation helpers.
 *
 * SubtitleTrack is data-only (timing + phrases). Font, color, size, and
 * family live on TextRenderer. This module is the one place that decides
 * *which string* a TextRenderer draws: a Subtitle Source entity, the same
 * clip's own SubtitleTrack, or the static `text` field.
 */

import { getPhraseContextAt } from './subtitleTrack.js';

export const DEFAULT_TEXT_FONT_SIZE = 36;
export const DEFAULT_TEXT_FONT_COLOR = '#ffffff';
export const DEFAULT_TEXT_FONT_FAMILY = 'Inter';
export const DEFAULT_TEXT_FONT_WEIGHT = 800;

/**
 * Quote a family name for CSS / Canvas2D `font` strings when it contains
 * spaces or commas (e.g. "Times New Roman"), and always fall back to
 * sans-serif so a missing OS font doesn't collapse to the browser default.
 */
export function cssFontFamily(name) {
  const family = name || DEFAULT_TEXT_FONT_FAMILY;
  const quoted = /[\s,]/.test(family) ? `"${family.replace(/"/g, '\\"')}"` : family;
  return `${quoted}, sans-serif`;
}

function subtitleCompOf(entity) {
  return entity?.components?.find((c) => c.type === 'SubtitleTrack') || null;
}

/**
 * Resolve the string a TextRenderer should display at absolute timeline
 * `time`. Prefers an explicit `subtitleSourceId` (Inspector Subtitle Source
 * slot); if that is empty, a SubtitleTrack on the same entity is used so
 * adding both components to one clip just works. Falls back to
 * `textComp.text` / `entity.name` when no subtitle source applies.
 */
export function resolveTextRendererText(textComp, entity, allEntities = [], time = 0) {
  if (!textComp) return entity?.name || '';

  let sourceEntity = null;
  if (textComp.subtitleSourceId) {
    sourceEntity = allEntities.find((e) => e.id === textComp.subtitleSourceId) || null;
  } else if (subtitleCompOf(entity)) {
    sourceEntity = entity;
  }

  if (sourceEntity) {
    const subtitleComp = subtitleCompOf(sourceEntity);
    if (subtitleComp) {
      const sourceLocalTime = time - (sourceEntity.startTime ?? 0);
      return getPhraseContextAt(subtitleComp, sourceLocalTime)?.text || '';
    }
  }

  return textComp.text || entity?.name || '';
}

export function isTextDrivenBySubtitle(textComp, entity) {
  if (textComp?.subtitleSourceId) return true;
  return Boolean(subtitleCompOf(entity));
}
