import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSafeBridgeId,
  validateBridgeCommandShape,
  MAX_BRIDGE_COMMAND_BYTES,
  MAX_BRIDGE_TIME_SECONDS,
} from '../src/utils/aiBridgeCore.js';

const base = { id: 'cmd-123', timestamp: 1_700_000_000_000 };

test('bridge: accepts every documented command shape', () => {
  assert.equal(validateBridgeCommandShape({ ...base, type: 'play' }), null);
  assert.equal(validateBridgeCommandShape({ ...base, type: 'pause' }), null);
  assert.equal(validateBridgeCommandShape({ ...base, type: 'reload' }), null);
  assert.equal(validateBridgeCommandShape({ ...base, type: 'seek', arg: 12.5 }), null);
  assert.equal(validateBridgeCommandShape({ ...base, type: 'seek', arg: '12.5' }), null);
  assert.equal(
    validateBridgeCommandShape({ ...base, type: 'select', arg: { id: 'entity-1' } }),
    null
  );
  assert.equal(
    validateBridgeCommandShape({ ...base, type: 'render_frame', arg: { time: 3, format: 'png' } }),
    null
  );
});

test('bridge: rejects ids that would be unsafe as outbox file names', () => {
  for (const id of ['', '../escape', 'a/b', 'a\\b', 'C:evil', '..', '.hidden', 'x'.repeat(129)]) {
    assert.equal(isSafeBridgeId(id), false, `expected "${id}" to be rejected`);
  }
  assert.equal(isSafeBridgeId('cmd-123'), true);
  assert.equal(isSafeBridgeId('9f1c2a4e-aaaa-bbbb-cccc-1234567890ab'), true);
  assert.match(
    validateBridgeCommandShape({ ...base, id: '../escape', type: 'play' }),
    /unsafe/
  );
});

test('bridge: rejects unknown commands and missing timestamps', () => {
  assert.match(validateBridgeCommandShape({ ...base, type: 'rm -rf' }), /Unknown bridge command/);
  assert.match(validateBridgeCommandShape({ id: 'cmd-1', type: 'play' }), /timestamp/);
  assert.match(
    validateBridgeCommandShape({ ...base, type: 'play', timestamp: Number.NaN }),
    /timestamp/
  );
});

test('bridge: rejects out-of-range seek and render times', () => {
  for (const arg of [-1, Infinity, Number.NaN, MAX_BRIDGE_TIME_SECONDS + 1, 'nope']) {
    assert.match(
      validateBridgeCommandShape({ ...base, type: 'seek', arg }),
      /needs a time/,
      `seek arg ${String(arg)} should be rejected`
    );
    assert.match(
      validateBridgeCommandShape({ ...base, type: 'render_frame', arg: { time: arg } }),
      /needs a time/,
      `render time ${String(arg)} should be rejected`
    );
  }
});

test('bridge: rejects an empty or oversized select target', () => {
  assert.match(validateBridgeCommandShape({ ...base, type: 'select', arg: '   ' }), /id or name/);
  assert.match(
    validateBridgeCommandShape({ ...base, type: 'select', arg: 'x'.repeat(201) }),
    /id or name/
  );
  assert.match(
    validateBridgeCommandShape({ ...base, type: 'select', arg: { name: '' } }),
    /id or name/
  );
});

test('bridge: command size cap is small enough to reject multi-megabyte inbox files', () => {
  assert.ok(MAX_BRIDGE_COMMAND_BYTES > 0);
  assert.ok(MAX_BRIDGE_COMMAND_BYTES <= 256 * 1024);
});
