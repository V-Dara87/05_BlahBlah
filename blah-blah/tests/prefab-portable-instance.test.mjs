import assert from 'node:assert/strict';
import { syncPrefabInstances } from '../src/engine/ecs.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    failed++;
    console.error('  ✗ ' + name);
    console.error(err);
  }
}

console.log('\nPortable Prefabs & Prefab Instances Tests\n');

function extractEmbeddedScripts(entities, availableScripts) {
  const usedScriptIds = new Set();
  entities.forEach((ent) => {
    (ent.components || []).forEach((c) => {
      if ((c.type === 'ScriptComponent' || c.type === 'MonoBehaviour') && c.scriptId) {
        usedScriptIds.add(c.scriptId);
      }
    });
  });
  return (availableScripts || []).filter((s) => usedScriptIds.has(s.id)).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description || '',
    code: s.code || '',
  }));
}

test('extractEmbeddedScripts: bundles referenced scripts into prefab', () => {
  const entities = [
    { id: 'e1', name: 'Animated Spinner', components: [
      { type: 'Transform', x: 0, y: 0 },
      { type: 'ScriptComponent', scriptId: 'scr-1', scriptName: 'Spinner.jsx' }
    ]},
  ];
  const availableScripts = [
    { id: 'scr-1', name: 'Spinner.jsx', code: 'export default function() {}' },
    { id: 'scr-2', name: 'Fade.jsx', code: '' }
  ];
  const embedded = extractEmbeddedScripts(entities, availableScripts);
  assert.equal(embedded.length, 1);
  assert.equal(embedded[0].name, 'Spinner.jsx');
  assert.equal(embedded[0].code, 'export default function() {}');
});

function placePrefabWithInstances(prefab, targetStartTime, targetTrackId) {
  const snapshots = Array.isArray(prefab.entities) && prefab.entities.length > 0 ? prefab.entities : null;
  const prefabInstanceId = 'pinst-12345';
  if (!snapshots) return [];
  return snapshots.map((snap) => ({
    id: 'new-' + snap.id,
    name: snap.name,
    startTime: targetStartTime + snap.startTime,
    prefabAssetId: prefab.id,
    prefabInstanceId,
    prefabSourceSnapId: snap.id,
    components: JSON.parse(JSON.stringify(snap.components || [])),
  }));
}

test('placePrefabWithInstances: tracks prefabAssetId and prefabInstanceId', () => {
  const prefab = {
    id: 'prefab-card',
    name: 'Card.prefab',
    entities: [
      { id: 'c1', name: 'Card', startTime: 0, components: [] },
      { id: 'c2', name: 'Icon', startTime: 1, components: [] }
    ]
  };
  const clips = placePrefabWithInstances(prefab, 10, 'track-1');
  assert.equal(clips.length, 2);
  assert.equal(clips[0].prefabAssetId, 'prefab-card');
  assert.equal(clips[0].prefabInstanceId, 'pinst-12345');
  assert.equal(clips[1].prefabSourceSnapId, 'c2');
});

function detachPrefab(entityId, entities) {
  const target = entities.find((e) => e.id === entityId);
  if (!target) return entities;
  const instId = target.prefabInstanceId;
  return entities.map((e) => {
    if ((instId && e.prefabInstanceId === instId) || e.id === entityId) {
      const { prefabAssetId: _pa, prefabInstanceId: _pi, prefabSourceSnapId: _ps, ...rest } = e;
      return rest;
    }
    return e;
  });
}

test('detachPrefab: strips prefab links from entire instance group', () => {
  const entities = [
    { id: 'c1', prefabAssetId: 'p1', prefabInstanceId: 'inst-1' },
    { id: 'c2', prefabAssetId: 'p1', prefabInstanceId: 'inst-1' },
    { id: 'o1', prefabAssetId: 'p2', prefabInstanceId: 'inst-2' }
  ];
  const detached = detachPrefab('c1', entities);
  assert.equal(detached[0].prefabAssetId, undefined);
  assert.equal(detached[0].prefabInstanceId, undefined);
  assert.equal(detached[2].prefabAssetId, 'p2');
});

function revertToPrefab(entityId, entities, prefabs) {
  const target = entities.find((e) => e.id === entityId);
  if (!target || !target.prefabAssetId) return entities;
  const prefab = prefabs.find((p) => p.id === target.prefabAssetId);
  if (!prefab) return entities;
  const snapshots = prefab.entities || [];
  const instId = target.prefabInstanceId;
  return entities.map((e) => {
    if (instId ? e.prefabInstanceId === instId : e.id === entityId) {
      const snap = snapshots.find((s) => s.id === e.prefabSourceSnapId);
      if (snap) {
        return { ...e, components: JSON.parse(JSON.stringify(snap.components || [])) };
      }
    }
    return e;
  });
}

test('revertToPrefab: resets components back to prefab snapshot', () => {
  const prefabs = [{ id: 'p1', entities: [{ id: 's1', components: [{ color: 'red' }] }] }];
  const entities = [{ id: 'c1', prefabAssetId: 'p1', prefabSourceSnapId: 's1', components: [{ color: 'blue' }] }];
  const reverted = revertToPrefab('c1', entities, prefabs);
  assert.equal(reverted[0].components[0].color, 'red');
});

test('syncPrefabInstances: updates components across all scene instances of prefab', () => {
  const sceneEntities = [
    { id: 'inst1-root', name: 'Button', prefabAssetId: 'pref-1', prefabInstanceId: 'inst-1', prefabSourceSnapId: 's-root', startTime: 2, duration: 4, components: [{ type: 'Shape', color: 'blue' }] },
    { id: 'inst2-root', name: 'Button', prefabAssetId: 'pref-1', prefabInstanceId: 'inst-2', prefabSourceSnapId: 's-root', startTime: 10, duration: 4, components: [{ type: 'Shape', color: 'blue' }] },
    { id: 'unrelated', name: 'Background', startTime: 0, duration: 20, components: [] },
  ];

  const updatedSnapshots = [
    { id: 's-root', name: 'Updated Button', parentId: null, startTime: 0, duration: 6, components: [{ type: 'Shape', color: 'gold' }] },
  ];

  const synced = syncPrefabInstances(sceneEntities, 'pref-1', updatedSnapshots, 's-root');

  assert.equal(synced.length, 3);
  const inst1 = synced.find((e) => e.id === 'inst1-root');
  const inst2 = synced.find((e) => e.id === 'inst2-root');
  const unrelated = synced.find((e) => e.id === 'unrelated');

  assert.equal(inst1.components[0].color, 'gold');
  assert.equal(inst1.name, 'Updated Button');
  assert.equal(inst1.startTime, 2); // Preserves scene placement!
  assert.equal(inst1.duration, 6);

  assert.equal(inst2.components[0].color, 'gold');
  assert.equal(inst2.name, 'Updated Button');
  assert.equal(inst2.startTime, 10); // Preserves scene placement!

  assert.equal(unrelated.id, 'unrelated');
});

test('syncPrefabInstances: spawns newly added child snapshot into existing scene instances', () => {
  const sceneEntities = [
    { id: 'inst1-root', name: 'Hero', prefabAssetId: 'pref-hero', prefabInstanceId: 'inst-1', prefabSourceSnapId: 's-root', trackId: 'track-1', startTime: 5, duration: 10, color: '#f00', components: [{ type: 'Transform', x: 0 }] },
  ];

  const updatedSnapshots = [
    { id: 's-root', name: 'Hero', parentId: null, startTime: 0, duration: 10, trackId: 'track-1', components: [{ type: 'Transform', x: 0 }] },
    { id: 's-child', name: 'Hero Aura', parentId: 's-root', startTime: 1, duration: 8, trackId: 'track-2', components: [{ type: 'Transform', x: 10 }] },
  ];

  const synced = syncPrefabInstances(sceneEntities, 'pref-hero', updatedSnapshots, 's-root');

  assert.equal(synced.length, 2);
  const root = synced.find((e) => e.id === 'inst1-root');
  const child = synced.find((e) => e.prefabSourceSnapId === 's-child');

  assert.ok(root);
  assert.ok(child);
  assert.equal(child.parentId, root.id); // Child is parented to the instance's root clip
  assert.equal(child.startTime, 6); // 5 + 1 = 6
  assert.equal(child.duration, 8);
  assert.equal(child.prefabInstanceId, 'inst-1');
  assert.equal(child.prefabAssetId, 'pref-hero');
});

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed\n');
if (failed > 0) process.exit(1);
