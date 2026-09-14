 
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
    // timingMode: 'duration' (default) allows setting how long each phrase lasts,
    // chaining phrases sequentially. 'range' exposes manual 'in' and 'out' timestamps.
    timingMode: 'duration',
    // displayMode: 'set' (default, replace each phrase) vs 'add' (accumulate phrases into sentence/list)
    displayMode: 'set',
    ...overrides,
  };
}

/**
 * Given a list of phrases where each phrase has a `duration` (or endTime - startTime),
 * recalculates all startTime and endTime sequentially starting from initialStart (default 0).
 */
export function recalculateSequentialPhrases(phrases = [], initialStart = 0) {
  let curr = initialStart;
  return phrases.map((p) => {
    const rawDur = Number.isFinite(p.duration) ? p.duration : Math.max(0.1, (p.endTime || 0) - (p.startTime || 0));
    const dur = Math.max(0.1, parseFloat(rawDur.toFixed(2)));
    const startTime = parseFloat(curr.toFixed(2));
    const endTime = parseFloat((curr + dur).toFixed(2));
    curr = endTime;
    return {
      ...p,
      duration: dur,
      startTime,
      endTime,
    };
  });
}
 
/** True for a SubtitleTrack component, mirroring isScriptComponent's style in ecs.js. */
export const isSubtitleTrackComponent = (c) => c?.type === 'SubtitleTrack';
 
/**
 * Create a single phrase object with sensible defaults. `words` and
 * `language` are intentionally left undefined (not `[]`/`''`) when not
 * given, so a plain phrase serializes/round-trips through SRT without
 * carrying empty placeholder fields that were never actually authored.
 */
export function createPhrase({ startTime, endTime, text, words, emphasis, language, id, mode } = {}) {
  const phrase = {
    id: id || `phrase-${crypto.randomUUID()}`,
    startTime: startTime ?? 0,
    endTime: endTime ?? Math.max((startTime ?? 0) + 1, 1),
    text: text ?? '',
    mode: mode || 'set', // 'set' (replace / start fresh sentence) vs 'add' (append to previous phrase)
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
  const isDuration = (component.timingMode || 'duration') === 'duration';
  let phrases = [...(component.phrases || []), phrase];
  if (isDuration) {
    phrases = recalculateSequentialPhrases(phrases, phrases[0]?.startTime || 0);
  } else {
    phrases = sortPhrases(phrases);
  }
  return { ...component, phrases };
}

/** Update one phrase by id with a partial patch, returning a new component. */
export function updatePhrase(component, phraseId, patch) {
  const isDuration = (component.timingMode || 'duration') === 'duration';
  let phrases = (component.phrases || []).map((p) => {
    if (p.id !== phraseId) return p;
    const updated = { ...p, ...patch };
    // If updating in duration mode, calculate duration or endTime accordingly
    if (patch.duration !== undefined) {
      updated.duration = Math.max(0.1, patch.duration);
    }
    return updated;
  });

  if (isDuration) {
    phrases = recalculateSequentialPhrases(phrases, phrases[0]?.startTime || 0);
  } else {
    phrases = sortPhrases(phrases);
  }
  return { ...component, phrases };
}

/** Remove one phrase by id, returning a new component. */
export function removePhrase(component, phraseId) {
  const isDuration = (component.timingMode || 'duration') === 'duration';
  let phrases = (component.phrases || []).filter((p) => p.id !== phraseId);
  if (isDuration) {
    phrases = recalculateSequentialPhrases(phrases, phrases[0]?.startTime || 0);
  }
  return { ...component, phrases };
}

/**
 * Reorder two phrases in the Inspector's phrase list.
 * In 'duration' mode, we reorder by array index and recalculate sequential times.
 * In 'range' mode, we swap startTime/endTime.
 */
export function reorderPhrases(component, draggedId, targetId) {
  if (!draggedId || !targetId || draggedId === targetId) return component;
  const phrases = component.phrases || [];
  const draggedIdx = phrases.findIndex((p) => p.id === draggedId);
  const targetIdx = phrases.findIndex((p) => p.id === targetId);
  if (draggedIdx === -1 || targetIdx === -1) return component;

  const isDuration = (component.timingMode || 'duration') === 'duration';
  if (isDuration) {
    const list = [...phrases];
    const [moved] = list.splice(draggedIdx, 1);
    list.splice(targetIdx, 0, moved);
    return { ...component, phrases: recalculateSequentialPhrases(list, list[0]?.startTime || 0) };
  }

  const dragged = phrases[draggedIdx];
  const target = phrases[targetIdx];
  const swapped = phrases.map((p) => {
    if (p.id === draggedId) return { ...p, startTime: target.startTime, endTime: target.endTime };
    if (p.id === targetId) return { ...p, startTime: dragged.startTime, endTime: dragged.endTime };
    return p;
  });
  return { ...component, phrases: sortPhrases(swapped) };
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
 
  // Helper: Find all phrases in the current cumulative group (starting from the most recent 'set' phrase up to targetIdx)
  const getSentencePhrases = (targetIdx) => {
    if (targetIdx < 0 || targetIdx >= sorted.length) return [];
    let startIdx = targetIdx;
    while (startIdx > 0 && sorted[startIdx].mode === 'add') {
      startIdx--;
    }
    return sorted.slice(startIdx, targetIdx + 1);
  };

  if (activeIndex === -1) {
    // In a gap — find the surrounding phrases by time for prev/next context.
    let prevIdx = -1;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].endTime <= t) prevIdx = i;
      else break;
    }
    const nextIdx = prevIdx + 1 < sorted.length ? prevIdx + 1 : -1;
    const currentSentencePhrases = prevIdx !== -1 ? getSentencePhrases(prevIdx) : [];
    const currentSentenceText = currentSentencePhrases.map((p) => p.text).filter(Boolean).join(' ');
    const allPastPhrases = prevIdx !== -1 ? sorted.slice(0, prevIdx + 1) : [];
    const allPastText = allPastPhrases.map((p) => p.text).filter(Boolean).join(' ');

    const prevPhrase = prevIdx !== -1 ? sorted[prevIdx] : null;
    const effectiveText = prevPhrase?.mode === 'add' || component.displayMode === 'add'
      ? currentSentenceText
      : '';

    return {
      text: effectiveText,
      sentenceText: currentSentenceText,
      sentencePhrases: currentSentencePhrases,
      accumulatedText: allPastText,
      accumulatedPhrases: allPastPhrases,
      index: null,
      phrase: null,
      prev: prevPhrase,
      next: nextIdx !== -1 ? sorted[nextIdx] : null,
    };
  }

  const activePhrase = sorted[activeIndex];
  const currentSentencePhrases = getSentencePhrases(activeIndex);
  const currentSentenceText = currentSentencePhrases.map((p) => p.text).filter(Boolean).join(' ');
  const allPastPhrases = sorted.slice(0, activeIndex + 1);
  const allPastText = allPastPhrases.map((p) => p.text).filter(Boolean).join(' ');

  // If the active phrase is 'add' (or if track is in 'add' mode), show the cumulative sentence text.
  // If the active phrase is 'set' (and track is in default 'set' mode), show only its own text.
  const isCumulative = activePhrase.mode === 'add' || component.displayMode === 'add';
  const effectiveText = isCumulative ? currentSentenceText : activePhrase.text;

  return {
    text: effectiveText,
    sentenceText: currentSentenceText,
    sentencePhrases: currentSentencePhrases,
    accumulatedText: allPastText,
    accumulatedPhrases: allPastPhrases,
    mode: activePhrase.mode || 'set',
    index: activeIndex,
    phrase: activePhrase,
    prev: activeIndex > 0 ? sorted[activeIndex - 1] : null,
    next: activeIndex < sorted.length - 1 ? sorted[activeIndex + 1] : null,
  };
}