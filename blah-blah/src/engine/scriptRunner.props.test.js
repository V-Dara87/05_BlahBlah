import test from 'node:test';
import assert from 'node:assert/strict';
import { extractScriptProps } from './scriptRunner.js';

/** A script whose `static props` exercises the attribute surface. */
const ATTRIBUTE_SCRIPT = `
export default class Demo {
  static props = {
    on:    { type: 'boolean', default: true, label: 'Motion', box: 'Motion', controls: 'Motion' },
    speed: { type: 'number',  default: 2, box: 'Motion', showIf: 'on', inline: true },
    mode:  { type: 'select',  default: 'a', options: ['a', 'b'], selectButton: true, tab: 'Advanced' },
    go:    { type: 'button',  label: 'Bake', action: 'bake' },
  };
}
`;

test('extractScriptProps - keeps plain typed fields as before', () => {
  const fields = extractScriptProps(`
    export default class Demo {
      static props = {
        speed: { type: 'number', default: 2, min: 0, max: 10, step: 0.5, label: 'Speed' },
        tint:  { type: 'color', default: '#ff0000' },
        label: 'hi',
      };
    }
  `);

  assert.deepEqual(fields[0], {
    name: 'speed',
    type: 'number',
    defaultVal: 2,
    min: 0,
    max: 10,
    step: 0.5,
    options: undefined,
    label: 'Speed',
  });
  assert.equal(fields[1].type, 'color');
  assert.equal(fields[2].type, 'string');
});

test('extractScriptProps - shorthand fields still infer their type', () => {
  const fields = extractScriptProps(`
    static props = { speed: 2.5, on: true, tint: '#00ff00', name: 'x' };
  `);
  assert.deepEqual(
    fields.map((f) => [f.name, f.type]),
    [['speed', 'number'], ['on', 'boolean'], ['tint', 'color'], ['name', 'string']],
  );
});

test('extractScriptProps - carries attributes onto the field', () => {
  const fields = extractScriptProps(ATTRIBUTE_SCRIPT);
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

  assert.equal(byName.on.box, 'Motion');
  assert.equal(byName.on.controls, 'Motion');
  assert.equal(byName.speed.showIf, 'on');
  assert.equal(byName.speed.inline, true);
  assert.equal(byName.mode.tab, 'Advanced');
  assert.equal(byName.mode.selectButton, true);
});

test('extractScriptProps - a button field carries its action, not a value', () => {
  const [button] = extractScriptProps(ATTRIBUTE_SCRIPT).filter((f) => f.type === 'button');
  assert.equal(button.name, 'go');
  assert.equal(button.label, 'Bake');
  assert.equal(button.action, 'bake');
  assert.equal(button.defaultVal, undefined);
});

test('extractScriptProps - a button without an action falls back to its own name', () => {
  const [button] = extractScriptProps("static props = { reset: { type: 'button' } };");
  assert.equal(button.action, 'reset');
  assert.equal(button.label, 'reset');
});

test('extractScriptProps - struct fields keep attributes and their sub-schema', () => {
  const fields = extractScriptProps(`
    static props = {
      title: { type: 'struct', label: 'Title', foldout: 'Text', fields: {
        text:  { type: 'string', default: 'Hello' },
        color: { type: 'color',  default: '#ffffff' },
      }},
    }
  `);
  assert.equal(fields[0].type, 'struct');
  assert.equal(fields[0].foldout, 'Text');
  assert.deepEqual(Object.keys(fields[0].fields), ['text', 'color']);
  assert.deepEqual(fields[0].defaultVal, { text: 'Hello', color: '#ffffff' });
});

test('extractScriptProps - reference fields are unchanged by the attribute pass', () => {
  const fields = extractScriptProps(`
    static props = {
      target: { type: 'entity', label: 'Target' },
      clip:   { type: 'asset' },
    }
  `);
  assert.deepEqual(fields.map((f) => [f.name, f.type, f.defaultVal]), [
    ['target', 'entity', null],
    ['clip', 'asset', null],
  ]);
});

test('extractScriptProps - extracts primitive and reference array types', () => {
  const fields = extractScriptProps(`
    static props = {
      tags:    { type: 'string[]', default: ['tag1', 'tag2'], label: 'Tags' },
      scores:  { type: 'number[]', min: 0, max: 100 },
      colors:  { type: 'color[]' },
      flags:   { type: 'boolean[]' },
      images:  { type: 'asset[]', label: 'Images' },
      targets: { type: 'entity[]' },
      custom:  { type: 'array', itemType: 'string', default: ['hello'] },
    }
  `);

  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
  assert.equal(byName.tags.type, 'string[]');
  assert.equal(byName.tags.itemType, 'string');
  assert.deepEqual(byName.tags.defaultVal, ['tag1', 'tag2']);

  assert.equal(byName.scores.type, 'number[]');
  assert.equal(byName.scores.itemType, 'number');
  assert.equal(byName.scores.min, 0);
  assert.equal(byName.scores.max, 100);

  assert.equal(byName.images.type, 'asset[]');
  assert.equal(byName.images.itemType, 'asset');

  assert.equal(byName.targets.type, 'entity[]');
  assert.equal(byName.targets.itemType, 'entity');

  assert.equal(byName.custom.type, 'array');
  assert.equal(byName.custom.itemType, 'string');
  assert.deepEqual(byName.custom.defaultVal, ['hello']);
});

test('extractScriptProps - shorthand array literals infer item types', () => {
  const fields = extractScriptProps(`
    static props = {
      words: ['apple', 'banana'],
      nums: [1, 2, 3],
    };
  `);
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
  assert.equal(byName.words.type, 'string[]');
  assert.equal(byName.words.itemType, 'string');
  assert.deepEqual(byName.words.defaultVal, ['apple', 'banana']);

  assert.equal(byName.nums.type, 'number[]');
  assert.equal(byName.nums.itemType, 'number');
  assert.deepEqual(byName.nums.defaultVal, [1, 2, 3]);
});

test('resolveScriptProps - resolves asset[] and entity[] while passing primitive arrays through', async () => {
  const { resolveScriptProps } = await import('./referenceTypes.js');
  const schema = [
    { name: 'tags', type: 'string[]', itemType: 'string' },
    { name: 'images', type: 'asset[]', itemType: 'asset' },
    { name: 'targets', type: 'entity[]', itemType: 'entity' },
  ];
  const allEntities = [
    { id: 'ent-1', name: 'Player' },
    { id: 'ent-2', name: 'Enemy' },
  ];
  const allAssets = [
    { id: 'ast-1', name: 'bg.png', src: 'blob:bg' },
    { id: 'ast-2', name: 'icon.png', src: 'blob:icon' },
  ];

  const rawProps = {
    tags: ['motion', 'vfx'],
    images: ['ast-1', 'ast-2'],
    targets: ['ent-1', 'missing-id'],
  };

  const resolved = resolveScriptProps(rawProps, schema, allEntities, allAssets);

  // Primitive arrays are untouched
  assert.deepEqual(resolved.tags, ['motion', 'vfx']);

  // Asset references resolved to AssetRef objects
  assert.equal(resolved.images.length, 2);
  assert.equal(resolved.images[0].id, 'ast-1');
  assert.equal(resolved.images[0].name, 'bg.png');
  assert.equal(resolved.images[0].exists(), true);

  // Entity references resolved to EntityRef objects
  assert.equal(resolved.targets.length, 2);
  assert.equal(resolved.targets[0].id, 'ent-1');
  assert.equal(resolved.targets[0].name, 'Player');
  assert.equal(resolved.targets[0].exists(), true);
  assert.equal(resolved.targets[1].exists(), false);
});

test('extractScriptProps - preserves targetComponent and assetType on fields and array fields', () => {
  const fields = extractScriptProps(`
    static props = {
      audioTrack: { type: 'entity', targetComponent: 'AudioSource', label: 'Audio Track' },
      bgImage: { type: 'asset', assetType: 'image', label: 'Background' },
      soundList: { type: 'entity[]', targetComponent: 'AudioSource', default: [] },
      photoList: { type: 'asset[]', assetType: 'image', default: [] },
    };
  `);
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
  assert.equal(byName.audioTrack.targetComponent, 'AudioSource');
  assert.equal(byName.bgImage.assetType, 'image');
  assert.equal(byName.soundList.targetComponent, 'AudioSource');
  assert.equal(byName.photoList.assetType, 'image');
});

test('makeEntityRef - provides Audio Sync API methods', async () => {
  const { makeEntityRef } = await import('./referenceTypes.js');
  const audioEntity = {
    id: 'audio-1',
    name: 'BGM Clip',
    startTime: 2.0,
    duration: 5.0,
    trackId: 'track-audio-1',
    components: [
      {
        type: 'Transform',
        speed: 1.0,
      },
      {
        type: 'AudioSource',
        assetId: 'asset-music',
        volume: 0.8,
        speed: 1.5,
        mediaOffset: 1.0,
        mediaDuration: 10.0,
        muted: false,
        loop: false,
      },
    ],
  };

  const assets = [
    { id: 'asset-music', src: 'blob:music.mp3', duration: 10.0 },
  ];

  const ref = makeEntityRef(audioEntity, [audioEntity], assets);
  assert.equal(ref.exists(), true);
  assert.equal(ref.endTime, 7.0);
  assert.equal(ref.trackId, 'track-audio-1');
  assert.equal(ref.audioSrc, 'blob:music.mp3');
  assert.equal(ref.audioDuration, 10.0);

  // isPlayingAt
  assert.equal(ref.isPlayingAt(1.0), false); // before startTime (2.0)
  assert.equal(ref.isPlayingAt(2.0), true);  // at start
  assert.equal(ref.isPlayingAt(5.0), true);  // during clip
  assert.equal(ref.isPlayingAt(7.0), false); // at endTime
  assert.equal(ref.isPlayingAt(8.0), false); // after clip

  // getAudioTime: effectiveSpeed = 1.0 * 1.5 = 1.5
  // at timelineTime = 4.0: localTime = 2.0. mediaTime = 1.0 (mediaOffset) + 2.0 * 1.5 = 4.0
  assert.equal(ref.getAudioTime(4.0), 4.0);
  // localTime mode: at localTime = 2.0, should match
  assert.equal(ref.getAudioTime(2.0, true), 4.0);

  // getAudioProgress
  // at timelineTime = 4.5: localTime = 2.5. duration = 5.0 -> progress = 0.5
  assert.equal(ref.getAudioProgress(4.5), 0.5);
  assert.equal(ref.getAudioProgress(2.5, true), 0.5);

  // getAudioSettings
  const settings = ref.getAudioSettings();
  assert.equal(settings.volume, 0.8);
  assert.equal(settings.effectiveSpeed, 1.5);
  assert.equal(settings.muted, false);
});

test('AssetRef and EntityRef - provides Audio Firing API (play, playOneShot, pause, stop, isPlaying)', async () => {
  const { makeAssetRef, makeEntityRef } = await import('./referenceTypes.js');

  const asset = {
    id: 'asset-sfx',
    name: 'laser.mp3',
    src: 'blob:laser.mp3',
    type: 'audio',
    duration: 1.2,
  };

  const assetRef = makeAssetRef(asset);
  assert.equal(typeof assetRef.play, 'function');
  assert.equal(typeof assetRef.playOneShot, 'function');
  assert.equal(typeof assetRef.pause, 'function');
  assert.equal(typeof assetRef.stop, 'function');
  assert.equal(assetRef.isPlaying, false);

  // Mock global Audio to verify controls
  class MockAudio {
    constructor() {
      this.src = '';
      this.volume = 1;
      this.playbackRate = 1;
      this.loop = false;
      this.currentTime = 0;
      this.paused = true;
      this.ended = false;
    }
    async play() {
      this.paused = false;
      this.ended = false;
    }
    pause() {
      this.paused = true;
    }
  }

  const prevAudio = globalThis.Audio;
  globalThis.Audio = MockAudio;

  try {
    // Test playOneShot
    const shot = assetRef.playOneShot({ volume: 0.6, speed: 1.2, offset: 0.1 });
    assert.ok(shot instanceof MockAudio);
    assert.equal(shot.src, 'blob:laser.mp3');
    assert.equal(shot.volume, 0.6);
    assert.equal(shot.playbackRate, 1.2);
    assert.equal(shot.currentTime, 0.1);
    assert.equal(shot.paused, false);

    // Test play
    const dedicated = assetRef.play({ volume: 0.9, loop: true });
    assert.ok(dedicated instanceof MockAudio);
    assert.equal(dedicated.src, 'blob:laser.mp3');
    assert.equal(dedicated.volume, 0.9);
    assert.equal(dedicated.loop, true);
    assert.equal(assetRef.isPlaying, true);

    // Test pause
    assetRef.pause();
    assert.equal(dedicated.paused, true);
    assert.equal(assetRef.isPlaying, false);

    // Test stop
    assetRef.play();
    assert.equal(assetRef.isPlaying, true);
    assetRef.stop();
    assert.equal(dedicated.paused, true);
    assert.equal(dedicated.currentTime, 0);
    assert.equal(assetRef.isPlaying, false);

    // Test EntityRef with AudioSource
    const entity = {
      id: 'audio-ent',
      name: 'BGM',
      startTime: 0,
      duration: 10,
      components: [
        { type: 'AudioSource', src: 'blob:bgm.mp3' },
      ],
    };
    const entityRef = makeEntityRef(entity, [entity], []);
    assert.equal(typeof entityRef.play, 'function');
    assert.equal(typeof entityRef.playOneShot, 'function');
    const entShot = entityRef.playOneShot({ volume: 0.7 });
    assert.equal(entShot.src, 'blob:bgm.mp3');
    assert.equal(entShot.volume, 0.7);
  } finally {
    globalThis.Audio = prevAudio;
  }
});



