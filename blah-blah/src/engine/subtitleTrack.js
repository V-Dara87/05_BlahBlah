/**
 * SubtitleTrack — data-only component for timed subtitle phrases.
 *
 * Scope note (see the subtitle-track feature doc this was built from):
 * this component ONLY holds "what text shows when" — it owns no
 * animation, no font/color/size, and renders nothing by itself. That's
 * the whole point of splitting this out from `TextRenderer` rather than
 * extending it: presentation belongs to a `CanvasRenderer` script
 * reading this data via `EntityRef.getPhraseAt` / `getCurrentText` (see
 * referenceTypes.js), or an external tool — never to this component.
 *
 * Shape:
 *   {
 *     type: 'SubtitleTrack',
 *     phrases: [
 *       {
 *         id: string,
 *         startTime: number,   // seconds, entity-local time
 *         endTime: number,
 *         text: string,        // full phrase text
 *         words: [             // optional — only present if word-level
 *                               // timing is known (e.g. from Whisper-style
 *                               // transcription). Hand-authored / plain
 *                               // imported-SRT phrases leave this empty —
 *                               // SRT itself carries no word timing.
 *           { word: string, start: number, end: number }
 *         ],
 *         emphasis?: boolean,  // minimal styling *hint*, not a style
 *                              // property — gives a presentation script a
 *                              // reason to differentiate this phrase, does
 *                              // not grow this into a rich-text schema
 *         language?: string,  // reserved for future multi-language
 *                              // support; not surfaced in any UI yet
 *       },
 *       ...
 *     ],
 *   }
 *
 * Phrases are kept sorted by startTime — every mutation helper here
 * re-sorts on write so callers (Inspector list editor, Dopesheet, SRT
 * import) never have to remember to do it themselves.
 */

/**
 * Component factory, matching the convention other components use
 * (see engine/ecs.js's createDefaultTransform / createTransitionComponent).
 */
export function createSubtitleTrackComponent(overrides = {}) {
  return {
    type: 'SubtitleTrack',
    // Reference-mode toggle (see the feature scope doc's "opt-in" note):
    // most text needs keep using plain TextRenderer with zero added
    // complexity. This component existing on an entity is itself the
    // opt-in signal for Inspector/Dopesheet timing UI to appear — there
    // is no separate boolean, since a SubtitleTrack with no phrases yet
    // is already the "just switched into this mode" state.
    phrases: [],
    ...overrides,
  };
}

/** True for a SubtitleTrack component, mirroring isScriptComponent's style in ecs.js. */
export const isSubtitleTrackComponent = (c) => c?.type === 'SubtitleTrack';

/**
 * Create a single phrase object with sensible defaults. `words` and
 * `language` are intentionally left undefined (not `[]`/`''`) when not
 * given, so a plain phrase serializes/round-trips through SRT without
 * carrying empty placeholder fields that were never actually authored.
 */
export function createPhrase({ startTime, endTime, text, words, emphasis, language, id } = {}) {
  const phrase = {
    id: id || `phrase-${crypto.randomUUID()}`,
    startTime: startTime ?? 0,
    endTime: endTime ?? Math.max((startTime ?? 0) + 1, 1),
    text: text ?? '',
  };
  if (words && words.length > 0) phrase.words = words;
  if (emphasis) phrase.emphasis = true;
  if (language) phrase.language = language;
  return phrase;
}

function sortPhrases(phrases) {
  return [...phrases].sort((a, b) => a.startTime - b.startTime);
}

/** Add a phrase to a SubtitleTrack component, returning a new component (no mutation). */
export function addPhrase(component, phrase) {
  return { ...component, phrases: sortPhrases([...(component.phrases || []), phrase]) };
}

/** Update one phrase by id with a partial patch, returning a new component. */
export function updatePhrase(component, phraseId, patch) {
  const phrases = (component.phrases || []).map((p) => (p.id === phraseId ? { ...p, ...patch } : p));
  return { ...component, phrases: sortPhrases(phrases) };
}

/** Remove one phrase by id, returning a new component. */
export function removePhrase(component, phraseId) {
  return { ...component, phrases: (component.phrases || []).filter((p) => p.id !== phraseId) };
}

/**
 * Find the phrase active at local time `t`, plus its neighbors — the
 * shared lookup behind both the read API (referenceTypes.js) and any
 * future timeline/Inspector highlighting. `t` is entity-local time in
 * seconds, same convention as keyframes.js's evaluateField.
 *
 * Gap behavior (silence between phrases): documented explicit choice,
 * not an accident (see the feature scope doc) — during a gap this
 * returns `phrase: null` rather than holding over the previous phrase.
 * A presentation script that wants hold-last-phrase behavior can do so
 * itself using `prev`, which is always populated when available.
 *
 * Returns null only when the track has no phrases at all. Otherwise
 * returns { text, index, phrase, prev, next }, where `phrase`/`index`
 * are null during a gap (before the first phrase, after the last, or
 * between two non-adjacent-in-time phrases), and `text` is `''` in
 * that case.
 */
export function getPhraseContextAt(component, t) {
  const phrases = component?.phrases;
  if (!phrases || phrases.length === 0) return null;

  const sorted = phrases; // stored pre-sorted by the mutation helpers above
  let activeIndex = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (t >= sorted[i].startTime && t <= sorted[i].endTime) {
      activeIndex = i;
      break;
    }
  }

  if (activeIndex === -1) {
    // In a gap — find the surrounding phrases by time for prev/next context.
    let prevIdx = -1;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].endTime <= t) prevIdx = i;
      else break;
    }
    const nextIdx = prevIdx + 1 < sorted.length ? prevIdx + 1 : -1;
    return {
      text: '',
      index: null,
      phrase: null,
      prev: prevIdx !== -1 ? sorted[prevIdx] : null,
      next: nextIdx !== -1 ? sorted[nextIdx] : null,
    };
  }

  return {
    text: sorted[activeIndex].text,
    index: activeIndex,
    phrase: sorted[activeIndex],
    prev: activeIndex > 0 ? sorted[activeIndex - 1] : null,
    next: activeIndex < sorted.length - 1 ? sorted[activeIndex + 1] : null,
  };
}