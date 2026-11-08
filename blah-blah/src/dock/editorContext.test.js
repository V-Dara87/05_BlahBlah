import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Regression guard for the merged-context subscription.
 *
 * `useContext(EditorContext)` subscribes the calling component to the merged
 * editor value, so calling it unconditionally inside `useEditorActions()` /
 * `useEditorData()` made every dock panel re-render on every `editorData`
 * change — which defeats the selector store. The fallback for callers mounted
 * outside the split providers must therefore be the conditional `use()` call,
 * which is only reached when the split context is missing.
 *
 * This repository's test setup is plain `node:test` (no jsdom, no
 * testing-library), so a re-render count cannot be asserted directly; this
 * checks the exact call instead.
 */
const source = readFileSync(new URL('./EditorContext.jsx', import.meta.url), 'utf8');

/** Source of one exported function, up to the next doc block or export. */
function bodyOf(name) {
  const start = source.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, `${name} should exist`);
  const nextExport = source.indexOf('export function', start + 20);
  const nextDoc = source.indexOf('/**', start + 20);
  const end = Math.min(...[nextExport, nextDoc, source.length].filter((i) => i >= 0));
  return source.slice(start, end);
}

test('useEditorActions does not subscribe to the merged context', () => {
  const body = bodyOf('useEditorActions');
  assert.equal(
    body.includes('useContext(EditorContext)'),
    false,
    'useEditorActions must not call useContext(EditorContext) — that re-renders on every editorData change'
  );
  assert.equal(
    body.includes('use(EditorContext)'),
    true,
    'the outside-the-provider fallback should read the merged context with use()'
  );
});

test('useEditorData does not subscribe to the merged context', () => {
  const body = bodyOf('useEditorData');
  assert.equal(body.includes('useContext(EditorContext)'), false);
  assert.equal(body.includes('use(EditorContext)'), true);
});

test('useEditorContext still reads the merged context', () => {
  const body = bodyOf('useEditorContext');
  assert.equal(body.includes('useContext(EditorContext)'), true);
});

test('the split contexts are still exported and still separate', () => {
  assert.equal(source.includes('export const EditorActionsContext'), true);
  assert.equal(source.includes('export const EditorDataContext'), true);
});
