import test from 'node:test';
import assert from 'node:assert/strict';
import {
  explainErrorText,
  parseErrorBlocks,
  summarizeScriptError,
  errorLinesForScript,
  countScriptErrors,
} from './scriptErrorInfo.js';
 
const COMPILE = [
  'error[E001]: Unexpected "}"',
  ' --> entry.jsx:12:5',
  '  |',
  ' 12 |   }',
  '  |   ~',
  '',
  'error[E002]: Could not resolve "lodsh"',
  ' --> entry.jsx:3:20',
].join('\n');
 
test('parseErrorBlocks splits compile errors and reads locations', () => {
  const blocks = parseErrorBlocks(COMPILE);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { text: 'Unexpected "}"', file: 'entry.jsx', line: 12, column: 5 });
  assert.equal(blocks[1].line, 3);
  assert.equal(countScriptErrors(COMPILE), 2);
});
 
test('parseErrorBlocks handles a runtime error with a mapped location', () => {
  const msg = 'onUpdate: foo is not defined\n --> Arrow.jsx:7:3\n 7 | foo();';
  const [b] = parseErrorBlocks(msg);
  assert.equal(b.text, 'onUpdate: foo is not defined');
  assert.equal(b.file, 'Arrow.jsx');
  assert.equal(b.line, 7);
});
 
test('parseErrorBlocks falls back to the first line for plain text', () => {
  const [b] = parseErrorBlocks('Boom\n  at x (y:1:1)');
  assert.equal(b.text, 'Boom');
  assert.equal(b.line, null);
});
 
test('explainErrorText covers the common cases', () => {
  assert.match(explainErrorText('Unexpected "}"'), /closing bracket/);
  assert.match(explainErrorText('Unexpected end of file'), /never closed/);
  assert.match(explainErrorText('fooBar is not defined'), /"fooBar" is used but was never created/);
  assert.match(explainErrorText('Could not resolve "lodsh"'), /"lodsh" could not be found/);
  assert.match(explainErrorText("Cannot read properties of undefined (reading 'x')"), /\.x/);
  assert.match(explainErrorText('thing.go is not a function'), /"thing\.go"/);
  assert.match(explainErrorText('The symbol "a" has already been declared'), /"a" is defined twice/);
  assert.match(explainErrorText('Script paused: onUpdate() took 300ms twice'), /Re-enable/);
  assert.equal(explainErrorText('some very unusual failure'), null);
  assert.equal(explainErrorText(''), null);
});
 
test('summarizeScriptError builds a one-line summary', () => {
  const s = summarizeScriptError(COMPILE);
  assert.equal(s.headline, 'Unexpected "}"');
  assert.equal(s.location, 'entry.jsx:12:5');
  assert.equal(s.count, 2);
  assert.equal(s.line, 12);
  assert.match(s.hint, /closing bracket/);
});
 
test('summarizeScriptError shortens very long headlines', () => {
  const s = summarizeScriptError(`error[E001]: ${'x'.repeat(300)}`);
  assert.ok(s.headline.length <= 90);
  assert.ok(s.headline.endsWith('…'));
});
 
test('errorLinesForScript marks only this script\'s lines', () => {
  const msg = [
    'error[E001]: Unexpected "}"',
    ' --> entry.jsx:12:5',
    '',
    'error[E002]: Bad thing',
    ' --> node_modules/pkg/index.js:4:1',
    '',
    'error[E003]: Other file',
    ' --> Helper.jsx:9:1',
    '',
    'error[E004]: Own file',
    ' --> Arrow.jsx:2:1',
  ].join('\n');
  const map = errorLinesForScript(msg, 'Arrow.jsx');
  assert.deepEqual([...map.keys()].sort((a, b) => a - b), [2, 12]);
  assert.deepEqual(map.get(12), ['Unexpected "}"']);
  assert.equal(errorLinesForScript('', 'Arrow.jsx').size, 0);
});