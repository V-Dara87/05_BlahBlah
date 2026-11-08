import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEditorStore, createSelectionCache, shallowEqual } from './editorStore.js';

test('subscribers are notified when the state object changes', () => {
  const store = createEditorStore({ a: 1 });
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  store.setState({ a: 2 });
  assert.equal(calls, 1);
  assert.deepEqual(store.getState(), { a: 2 });
  off();
});

test('publishing the identical state object does not notify', () => {
  const state = { a: 1 };
  const store = createEditorStore(state);
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  store.setState(state);
  assert.equal(calls, 0);
});

test('unsubscribing stops notifications', () => {
  const store = createEditorStore(0);
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  store.setState(1);
  off();
  store.setState(2);
  assert.equal(calls, 1);
});

test('a listener may unsubscribe while being notified', () => {
  const store = createEditorStore(0);
  let calls = 0;
  const off = store.subscribe(() => {
    calls += 1;
    off();
    store.setState(store.getState()); // no-op republish while iterating
  });
  store.setState(1);
  store.setState(2);
  assert.equal(calls, 1);
});

test('a selector keeps its previous reference when the slice is unchanged', () => {
  const clips = [{ id: 'a' }];
  const store = createEditorStore({ clips, selection: null });
  const cache = createSelectionCache(store, (s) => s.clips);

  const first = cache.get();
  // A new state object, but the same clips array (structural sharing).
  store.setState({ clips, selection: 'a' });
  assert.equal(cache.get(), first);

  const nextClips = [{ id: 'b' }];
  store.setState({ clips: nextClips, selection: 'a' });
  assert.equal(cache.get(), nextClips);
});

test('shallowEqual lets a selector return an object without looping', () => {
  const store = createEditorStore({ a: 1, b: 2 });
  const cache = createSelectionCache(store, (s) => ({ a: s.a, b: s.b }), shallowEqual);

  const first = cache.get();
  store.setState({ a: 1, b: 2, c: 3 });
  assert.equal(cache.get(), first); // equal entries -> same object reference

  store.setState({ a: 1, b: 9, c: 3 });
  const changed = cache.get();
  assert.notEqual(changed, first);
  assert.equal(changed.b, 9);
});

test('a selector sees the newest state on every call', () => {
  const store = createEditorStore({ n: 1 });
  const cache = createSelectionCache(store, (s) => s.n);
  assert.equal(cache.get(), 1);
  store.setState({ n: 2 });
  assert.equal(cache.get(), 2);
});

test('the cached getter works when detached from its object', () => {
  const store = createEditorStore({ a: 1 });
  const cache = createSelectionCache(store, (s) => s.a);
  // useSyncExternalStore calls the snapshot detached.
  const { get } = cache;
  assert.equal(get(), 1);
  store.setState({ a: 2 });
  assert.equal(get(), 2);
});

test('shallowEqual compares arrays element-wise', () => {
  assert.equal(shallowEqual([1, 2], [1, 2]), true);
  assert.equal(shallowEqual([1, 2], [1, 3]), false);
  assert.equal(shallowEqual([1, 2], [1, 2, 3]), false);
  assert.equal(shallowEqual({ a: [1] }, { a: [1] }), false); // one level deep only
  assert.equal(shallowEqual(null, null), true);
  assert.equal(shallowEqual(null, {}), false);
});

test('derived selectors do not allocate a new array when nothing changed', () => {
  const entities = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const store = createEditorStore({ entities, selectedIds: [] });
  const selected = (s) => s.entities.filter((e) => s.selectedIds.includes(e.id));
  const cache = createSelectionCache(store, selected, shallowEqual);

  const first = cache.get();
  store.setState({ entities, selectedIds: [] });
  assert.equal(cache.get(), first);

  store.setState({ entities, selectedIds: ['b'] });
  const picked = cache.get();
  assert.deepEqual(picked.map((e) => e.id), ['b']);
});
