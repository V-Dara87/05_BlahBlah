import test from 'node:test';
import assert from 'node:assert/strict';
import { popoutGroup } from './popoutGroup.js';

/** Silence the helper's own console warnings — the point of these tests is the
 *  fallback behaviour, not the log line. */
function quiet(fn) {
  const original = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = original;
  }
}

function fakeApi(overrides = {}) {
  const calls = { popout: 0, float: 0 };
  const api = {
    addPopoutGroup: (...args) => {
      calls.popout += 1;
      return overrides.addPopoutGroup
        ? overrides.addPopoutGroup(...args)
        : Promise.resolve(true);
    },
    addFloatingGroup: (...args) => {
      calls.float += 1;
      return overrides.addFloatingGroup?.(...args);
    },
  };
  return { api, calls };
}

const gridGroup = { api: { location: { type: 'grid' } } };

test('popoutGroup - keeps the group in the pop-out window when it opens', async () => {
  const { api, calls } = fakeApi();
  const opened = await quiet(() => popoutGroup(api, gridGroup));
  assert.equal(opened, true);
  assert.equal(calls.popout, 1);
  assert.equal(calls.float, 0);
});

test('popoutGroup - floats the group when the pop-out window is blocked', async () => {
  const { api, calls } = fakeApi({ addPopoutGroup: () => Promise.resolve(false) });
  const opened = await quiet(() => popoutGroup(api, gridGroup));
  assert.equal(opened, false);
  assert.equal(calls.float, 1, 'a blocked pop-out should still detach the panel');
});

test('popoutGroup - floats the group when adding the pop-out rejects', async () => {
  const { api, calls } = fakeApi({
    addPopoutGroup: () => Promise.reject(new Error('pop-out URL must be same-origin http(s)')),
  });
  assert.equal(await quiet(() => popoutGroup(api, gridGroup)), false);
  assert.equal(calls.float, 1);
});

test('popoutGroup - floats the group when adding the pop-out throws', async () => {
  const { api, calls } = fakeApi({
    addPopoutGroup: () => {
      throw new Error('boom');
    },
  });
  assert.equal(await quiet(() => popoutGroup(api, gridGroup)), false);
  assert.equal(calls.float, 1);
});

test('popoutGroup - does not re-float a group that is already floating', async () => {
  const { api, calls } = fakeApi({ addPopoutGroup: () => Promise.resolve(false) });
  const floating = { api: { location: { type: 'floating' } } };
  await quiet(() => popoutGroup(api, floating));
  assert.equal(calls.popout, 1);
  assert.equal(calls.float, 0);
});

test('popoutGroup - leaves edge groups alone', async () => {
  const { api, calls } = fakeApi();
  const edge = { api: { location: { type: 'edge' } } };
  assert.equal(await popoutGroup(api, edge), false);
  assert.equal(calls.popout, 0);
  assert.equal(calls.float, 0);
});

test('popoutGroup - tolerates a missing api or group', async () => {
  assert.equal(await popoutGroup(null, gridGroup), false);
  assert.equal(await popoutGroup({ addPopoutGroup: () => true }, null), false);
});

test('popoutGroup - a throwing float fallback does not reject', async () => {
  const { api } = fakeApi({
    addPopoutGroup: () => Promise.resolve(false),
    addFloatingGroup: () => {
      throw new Error('no float');
    },
  });
  assert.equal(await quiet(() => popoutGroup(api, gridGroup)), false);
});
