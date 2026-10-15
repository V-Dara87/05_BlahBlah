import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pushRuntimeError,
  pushCompileError,
  pushInfo,
  clearConsole,
  findLatestErrorEntry,
  requestConsoleFocus,
  getConsoleFocus,
  subscribeConsoleFocus,
  clearConsoleFocus,
  sameScriptName,
} from './scriptConsole.js';
 
test('sameScriptName ignores the extension', () => {
  assert.equal(sameScriptName('Arrow.jsx', 'Arrow'), true);
  assert.equal(sameScriptName('Arrow.jsx', 'Other.jsx'), false);
  assert.equal(sameScriptName('', 'Arrow'), false);
});
 
test('findLatestErrorEntry skips non-errors and filters by script', () => {
  clearConsole();
  const a = pushCompileError('error[E001]: a', 'A.jsx');
  pushInfo('fine', 'B.jsx');
  const b = pushRuntimeError('boom', 'B.jsx');
  assert.equal(findLatestErrorEntry().id, b.id);
  assert.equal(findLatestErrorEntry('A').id, a.id);
  assert.equal(findLatestErrorEntry('Nope'), null);
});
 
test('requestConsoleFocus targets an entry and notifies subscribers', () => {
  clearConsole();
  const a = pushCompileError('error[E001]: a', 'A.jsx');
  const seen = [];
  const unsub = subscribeConsoleFocus((id) => seen.push(id));
  requestConsoleFocus({ scriptName: 'A.jsx' });
  assert.equal(getConsoleFocus(), a.id);
  clearConsoleFocus();
  assert.equal(getConsoleFocus(), null);
  assert.deepEqual(seen, [a.id, null]);
  unsub();
});
 
test('requestConsoleFocus falls back to the latest error, and clearConsole resets focus', () => {
  clearConsole();
  const b = pushRuntimeError('boom', 'B.jsx');
  requestConsoleFocus({ scriptName: 'Missing.jsx' });
  assert.equal(getConsoleFocus(), b.id);
  clearConsole();
  assert.equal(getConsoleFocus(), null);
});