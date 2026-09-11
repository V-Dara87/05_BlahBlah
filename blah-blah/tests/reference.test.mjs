import assert from 'node:assert/strict';
import { makeEntityRef, makeAssetRef, resolveScriptProps } from '../src/engine/referenceTypes.js';
import { extractScriptProps, executeScriptComponent } from '../src/engine/scriptRunner.js';
import { computeActiveEntitiesAtTime } from '../src/engine/renderPipeline.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

console.log('\nReference Feature Tests\n');

// ─── 1. makeEntityRef ────────────────────────────────────────────────────────

test('makeEntityRef: returns valid EntityRef for existing entity', () => {
  const entity = {
    id: 'ent-1',
    name: 'Player',
    startTime: 2.0,
    duration: 5.0,
    parentId: 'parent-1',
    components: [
      {
        type: 'Transform',
        x: 100,
        y: 200,
        rotation: 45,
        scaleX: 2,
        scaleY: 2,
        opacity: 0.8,
        speed: 1.5,
      },
      {
        type: 'TextRenderer',
        text: 'Hello World',
        fontSize: 32,
      },
    ],
  };

  const allEntities = [entity];
  const ref = makeEntityRef(entity, allEntities);

  assert.equal(ref.id, 'ent-1');
  assert.equal(ref.name, 'Player');
  assert.equal(ref.startTime, 2.0);
  assert.equal(ref.duration, 5.0);
  assert.equal(ref.parentId, 'parent-1');
  assert.equal(ref.exists(), true);

  const t = ref.getTransform();
  assert.deepEqual(t, {
    x: 100,
    y: 200,
    rotation: 45,
    scaleX: 2,
    scaleY: 2,
    opacity: 0.8,
    speed: 1.5,
  });

  const textComp = ref.getComponent('TextRenderer');
  assert.ok(textComp);
  assert.equal(textComp.text, 'Hello World');

  const missingComp = ref.getComponent('VideoRenderer');
  assert.equal(missingComp, null);
});

test('makeEntityRef: handles null / deleted entity gracefully', () => {
  const ref = makeEntityRef(null);
  assert.equal(ref.id, null);
  assert.equal(ref.name, null);
  assert.equal(ref.exists(), false);
  assert.equal(ref.getTransform(), null);
  assert.equal(ref.getComponent('Transform'), null);
});

test('makeEntityRef: exists() reports false when entity is removed from allEntities', () => {
  const entity = { id: 'ent-deleted', name: 'Deleted Clip', components: [] };
  const allEntities = [{ id: 'other', name: 'Other', components: [] }];
  const ref = makeEntityRef(entity, allEntities);

  assert.equal(ref.exists(), false);
});

// ─── 2. makeAssetRef ─────────────────────────────────────────────────────────

test('makeAssetRef: returns valid AssetRef for existing asset', () => {
  const asset = {
    id: 'asset-video-1',
    name: 'intro.mp4',
    src: 'blob:http://localhost/video-1',
    type: 'video',
    duration: 12.5,
  };

  const ref = makeAssetRef(asset);

  assert.equal(ref.id, 'asset-video-1');
  assert.equal(ref.name, 'intro.mp4');
  assert.equal(ref.src, 'blob:http://localhost/video-1');
  assert.equal(ref.type, 'video');
  assert.equal(ref.duration, 12.5);
  assert.equal(ref.exists(), true);
});

test('makeAssetRef: handles null / empty asset gracefully', () => {
  const ref = makeAssetRef(null);
  assert.equal(ref.id, null);
  assert.equal(ref.name, null);
  assert.equal(ref.src, null);
  assert.equal(ref.type, null);
  assert.equal(ref.duration, null);
  assert.equal(ref.exists(), false);
});

// ─── 3. extractScriptProps with reference types ─────────────────────────────

test('extractScriptProps: extracts entity and asset types with defaultVal null', () => {
  const scriptCode = `
    export default class FollowTarget {
      static props = {
        target: { type: 'entity', label: 'Target Clip' },
        media:  { type: 'asset',  label: 'Background Video' },
        speed:  { type: 'number', default: 2.0 },
      };
      onUpdate() {}
    }
  `;

  const props = extractScriptProps(scriptCode);
  assert.equal(props.length, 3);

  const targetProp = props.find((p) => p.name === 'target');
  assert.ok(targetProp);
  assert.equal(targetProp.type, 'entity');
  assert.equal(targetProp.defaultVal, null);
  assert.equal(targetProp.label, 'Target Clip');

  const mediaProp = props.find((p) => p.name === 'media');
  assert.ok(mediaProp);
  assert.equal(mediaProp.type, 'asset');
  assert.equal(mediaProp.defaultVal, null);

  const speedProp = props.find((p) => p.name === 'speed');
  assert.ok(speedProp);
  assert.equal(speedProp.type, 'number');
  assert.equal(speedProp.defaultVal, 2.0);
});

// ─── 4. resolveScriptProps ───────────────────────────────────────────────────

test('resolveScriptProps: resolves entity and asset IDs into Ref objects', () => {
  const entities = [
    {
      id: 'target-1',
      name: 'Leader',
      startTime: 0,
      duration: 10,
      components: [
        { type: 'Transform', x: 300, y: 150, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, speed: 1 },
      ],
    },
  ];

  const assets = [
    {
      id: 'asset-1',
      name: 'bg.jpg',
      src: 'blob:http://localhost/bg',
      type: 'image',
      duration: null,
    },
  ];

  const schema = [
    { name: 'target', type: 'entity' },
    { name: 'background', type: 'asset' },
    { name: 'offset', type: 'number', defaultVal: 50 },
  ];

  const rawProps = {
    target: 'target-1',
    background: 'asset-1',
    offset: 75,
  };

  const resolved = resolveScriptProps(rawProps, schema, entities, assets);

  // target is resolved to an EntityRef
  assert.equal(typeof resolved.target.getTransform, 'function');
  assert.equal(resolved.target.name, 'Leader');
  assert.equal(resolved.target.getTransform().x, 300);

  // background is resolved to an AssetRef
  assert.equal(resolved.background.name, 'bg.jpg');
  assert.equal(resolved.background.type, 'image');

  // offset number is unchanged
  assert.equal(resolved.offset, 75);
});

test('resolveScriptProps: handles unassigned/missing refs safely', () => {
  const schema = [
    { name: 'target', type: 'entity' },
    { name: 'clip', type: 'asset' },
  ];

  const rawProps = {
    target: null,
    clip: undefined,
  };

  const resolved = resolveScriptProps(rawProps, schema, [], []);
  assert.equal(resolved.target.exists(), false);
  assert.equal(resolved.target.getTransform(), null);
  assert.equal(resolved.clip.exists(), false);
  assert.equal(resolved.clip.src, null);
});

// ─── 5. executeScriptComponent with reference props ─────────────────────────

test('executeScriptComponent: motion script reads props.target.getTransform()', () => {
  const targetEntity = {
    id: 'leader',
    name: 'Leader Clip',
    startTime: 0,
    duration: 10,
    components: [
      { type: 'Transform', x: 500, y: 250, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, speed: 1 },
    ],
  };

  const followerScript = `
    export default class Follower {
      static props = {
        target: { type: 'entity', label: 'Target' },
        offsetX: { type: 'number', default: 50 }
      };

      onUpdate({ transform, props }) {
        if (props.target && props.target.exists()) {
          const t = props.target.getTransform();
          if (t) {
            transform.position.x = t.x + (props.offsetX || 0);
            transform.position.y = t.y;
          }
        }
      }
    }
  `;

  const initialTransform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
  const publicValues = { target: 'leader', offsetX: 30 };

  const updatedTransform = executeScriptComponent({
    scriptCode: followerScript,
    transform: initialTransform,
    localTime: 1.0,
    clipDuration: 5,
    publicValues,
    allEntities: [targetEntity],
    allAssets: [],
  });

  // Follower's X should be target's X (500) + offsetX (30) = 530
  assert.equal(updatedTransform.x, 530);
  assert.equal(updatedTransform.y, 250);
});

// ─── 6. computeActiveEntitiesAtTime with reference resolution ───────────────

test('computeActiveEntitiesAtTime: resolves reference in motion script across timeline', () => {
  const leader = {
    id: 'leader-1',
    name: 'Leader',
    trackId: 'track-1',
    startTime: 0,
    duration: 10,
    active: true,
    components: [
      { type: 'Transform', x: 400, y: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, speed: 1 },
    ],
  };

  const follower = {
    id: 'follower-1',
    name: 'Follower',
    trackId: 'track-2',
    startTime: 0,
    duration: 10,
    active: true,
    components: [
      { type: 'Transform', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, speed: 1 },
      {
        type: 'ScriptComponent',
        scriptId: 'follow-script-id',
        enabled: true,
        props: { target: 'leader-1' },
      },
    ],
  };

  const scripts = [
    {
      id: 'follow-script-id',
      name: 'FollowScript.jsx',
      code: `
        export default class FollowerScript {
          static props = {
            target: { type: 'entity' }
          };
          onUpdate({ transform, props }) {
            if (props.target && props.target.exists()) {
              const t = props.target.getTransform();
              if (t) {
                transform.position.x = t.x + 20;
              }
            }
          }
        }
      `,
    },
  ];

  const tracks = [
    { id: 'track-1', visible: true, locked: false },
    { id: 'track-2', visible: true, locked: false },
  ];

  const active = computeActiveEntitiesAtTime({
    entities: [leader, follower],
    tracks,
    scripts,
    time: 1.0,
    fps: 30,
  });

  assert.equal(active.length, 2);
  const followerActive = active.find((a) => a.entity.id === 'follower-1');
  assert.ok(followerActive);
  assert.equal(followerActive.transform.x, 420);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  for (const f of failures) {
    console.error(`FAILED: ${f.name}`);
    console.error(f.err);
  }
  process.exit(1);
}
