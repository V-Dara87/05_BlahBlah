import assert from 'node:assert/strict';
import { test } from 'node:test';
import { subscribeDocumentChange, notifyDocumentChange } from './documentChange.js';

test('notifyDocumentChange reaches every subscriber', () => {
  let a = 0;
  let b = 0;
  const offA = subscribeDocumentChange(() => { a += 1; });
  const offB = subscribeDocumentChange(() => { b += 1; });

  notifyDocumentChange();
  notifyDocumentChange();

  assert.equal(a, 2);
  assert.equal(b, 2);
  offA();
  offB();
});

test('unsubscribing stops further notifications', () => {
  let calls = 0;
  const off = subscribeDocumentChange(() => { calls += 1; });
  notifyDocumentChange();
  off();
  notifyDocumentChange();
  assert.equal(calls, 1);
});

test('a listener can unsubscribe itself while being notified', () => {
  let calls = 0;
  const off = subscribeDocumentChange(() => {
    calls += 1;
    off();
  });
  notifyDocumentChange();
  notifyDocumentChange();
  assert.equal(calls, 1);
});

test('notifying with no subscribers is a no-op', () => {
  assert.doesNotThrow(() => notifyDocumentChange());
});
