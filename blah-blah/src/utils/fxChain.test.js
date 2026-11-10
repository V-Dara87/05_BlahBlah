import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FX_SLOTS,
  normalizeFxSlot,
  normalizeTrackFx,
  serializeFxChain,
  absoluteStateFile,
  fxCacheKey,
} from './fxChain.js';

const CID = '0123456789abcdef0123456789abcdef';

test('normalizeFxSlot drops malformed slots and keeps VST3 metadata', () => {
  assert.equal(normalizeFxSlot(null), null);
  assert.equal(normalizeFxSlot({ pluginPath: 'C:/x.vst3', classId: 'not-a-cid' }), null);

  const slot = normalizeFxSlot({
    id: 'slot-1',
    pluginPath: 'C:/Plugins/Test.vst3',
    classId: CID.toUpperCase(),
    name: 'Test',
    vendor: 'Vendor',
    stateFile: 'fx/slot-1.bin',
  });
  assert.equal(slot.classId, CID);
  assert.equal(slot.format, 'vst3');
  assert.equal(slot.bypass, false);
});

test('normalizeTrackFx caps slots and supplies empty defaults', () => {
  const track = normalizeTrackFx({
    id: 'track-1',
    fx: Array.from({ length: MAX_FX_SLOTS + 2 }, (_, i) => ({
      pluginPath: `C:/P/${i}.vst3`,
      classId: CID,
    })),
  });
  assert.equal(track.fx.length, MAX_FX_SLOTS);
  assert.equal(track.fxBypassAll, false);
  assert.deepEqual(normalizeTrackFx({ id: 'track-2' }).fx, []);
});

test('serializeFxChain resolves state files relative to the project folder', () => {
  assert.equal(
    absoluteStateFile('fx/a.bin', 'D:/Projects/demo'),
    'D:/Projects/demo/fx/a.bin'
  );
  const chain = serializeFxChain({
    fx: [{ pluginPath: 'C:/P/a.vst3', classId: CID, stateFile: 'fx/a.bin', bypass: false }],
  }, 'D:/Projects/demo');
  assert.equal(chain[0].plugin, 'C:/P/a.vst3');
  assert.equal(chain[0].stateFile, 'D:/Projects/demo/fx/a.bin');
  assert.equal(chain[0].classId, CID);
});

test('fxCacheKey changes with chain and range but not object key order', async () => {
  const base = {
    track: { id: 't1' },
    chain: [{ plugin: 'C:/a.vst3', classId: CID }],
    startTime: 0,
    duration: 12,
    sampleRate: 48000,
    entities: [{ id: 'e1', startTime: 0, duration: 5, components: [] }],
  };
  const a = await fxCacheKey(base);
  const b = await fxCacheKey({ ...base, chain: [{ classId: CID, plugin: 'C:/a.vst3' }] });
  const c = await fxCacheKey({ ...base, duration: 13 });
  assert.equal(a, b);
  assert.notEqual(a, c);
});
