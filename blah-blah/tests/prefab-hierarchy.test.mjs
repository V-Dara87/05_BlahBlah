import assert from 'node:assert/strict';

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

console.log('\nPrefab Hierarchy & Timeline Mode Tests\n');

// ─── 1. Hierarchical Snapshot Collection ────────────────────────────────────

function collectPrefabSnapshots(rootEntity, allEntities) {
  const collectedIds = new Set([rootEntity.id]);
  let addedNew = true;
  while (addedNew) {
    addedNew = false;
    for (const ent of allEntities) {
      if (ent.parentId && collectedIds.has(ent.parentId) && !collectedIds.has(ent.id)) {
        collectedIds.add(ent.id);
        addedNew = true;
      }
    }
  }

  const rootStartTime = rootEntity.startTime || 0;
  return allEntities
    .filter((e) => collectedIds.has(e.id))
    .map((e) => ({
      ...JSON.parse(JSON.stringify(e)),
      startTime: Math.max(0, (e.startTime || 0) - rootStartTime),
      parentId: e.id === rootEntity.id ? null : e.parentId,
    }));
}

test('collectPrefabSnapshots: single entity without children', () => {
  const root = { id: 'e1', name: 'Button', startTime: 5, duration: 3, components: [], parentId: null };
  const snapshots = collectPrefabSnapshots(root, [root]);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].id, 'e1');
  assert.equal(snapshots[0].startTime, 0);
  assert.equal(snapshots[0].parentId, null);
});

test('collectPrefabSnapshots: captures parent, child, and grandchild with relative times', () => {
  const entities = [
    { id: 'card', name: 'Card Parent', startTime: 10, duration: 8, components: [], parentId: null },
    { id: 'title', name: 'Card Title', startTime: 10.5, duration: 6, components: [], parentId: 'card' },
    { id: 'icon', name: 'Card Icon', startTime: 11, duration: 4, components: [], parentId: 'title' },
    { id: 'unrelated', name: 'Unrelated', startTime: 0, duration: 20, components: [], parentId: null },
  ];

  const snapshots = collectPrefabSnapshots(entities[0], entities);
  assert.equal(snapshots.length, 3);
  assert.deepEqual(snapshots.map((s) => s.id), ['card', 'title', 'icon']);

  const cardSnap = snapshots.find((s) => s.id === 'card');
  const titleSnap = snapshots.find((s) => s.id === 'title');
  const iconSnap = snapshots.find((s) => s.id === 'icon');

  assert.equal(cardSnap.startTime, 0);
  assert.equal(titleSnap.startTime, 0.5);
  assert.equal(iconSnap.startTime, 1);

  assert.equal(cardSnap.parentId, null);
  assert.equal(titleSnap.parentId, 'card');
  assert.equal(iconSnap.parentId, 'title');
});

// ─── 2. Hierarchical Prefab Instantiation ───────────────────────────────────

function instantiatePrefabOnTimeline(prefab, targetStartTime, targetTrackId) {
  const isMultiEntity = Array.isArray(prefab.entities) && prefab.entities.length > 0;
  if (!isMultiEntity) {
    const newId = `entity-${Date.now()}`;
    return [{
      id: newId,
      name: prefab.name.replace(/ Prefab$/, ''),
      trackId: targetTrackId || 'track-1',
      startTime: targetStartTime,
      duration: prefab.duration || 5,
      components: JSON.parse(JSON.stringify(prefab.components || [])),
      parentId: null,
    }];
  }

  const oldToNew = new Map();
  prefab.entities.forEach((snap) => {
    oldToNew.set(snap.id, `new-${snap.id}`);
  });

  const rootSnap = prefab.entities.find((e) => e.id === prefab.rootId || !e.parentId) || prefab.entities[0];
  const rootTrackId = rootSnap?.trackId || targetTrackId || 'track-1';

  return prefab.entities.map((snap) => {
    const isRoot = snap.id === rootSnap?.id;
    return {
      ...JSON.parse(JSON.stringify(snap)),
      id: oldToNew.get(snap.id),
      startTime: targetStartTime + (snap.startTime || 0),
      trackId: isRoot ? (targetTrackId || rootTrackId) : (snap.trackId || targetTrackId || 'track-1'),
      parentId: snap.parentId ? oldToNew.get(snap.parentId) : null,
    };
  });
}

test('instantiatePrefab: instantiates hierarchical prefab with remapped parentIds and offset startTimes', () => {
  const prefab = {
    id: 'prefab-1',
    name: 'Modal Dialog Prefab',
    rootId: 'modal-root',
    duration: 6,
    entities: [
      { id: 'modal-root', name: 'Modal', startTime: 0, duration: 6, trackId: 'track-1', parentId: null },
      { id: 'modal-btn', name: 'Confirm Button', startTime: 1.2, duration: 4, trackId: 'track-2', parentId: 'modal-root' },
      { id: 'modal-txt', name: 'Button Text', startTime: 1.5, duration: 3.5, trackId: 'track-3', parentId: 'modal-btn' },
    ],
  };

  const instantiated = instantiatePrefabOnTimeline(prefab, 15, 'track-1');
  assert.equal(instantiated.length, 3);

  const newRoot = instantiated[0];
  const newBtn = instantiated[1];
  const newTxt = instantiated[2];

  assert.equal(newRoot.id, 'new-modal-root');
  assert.equal(newRoot.startTime, 15);
  assert.equal(newRoot.parentId, null);

  assert.equal(newBtn.id, 'new-modal-btn');
  assert.equal(newBtn.startTime, 16.2);
  assert.equal(newBtn.parentId, newRoot.id);

  assert.equal(newTxt.id, 'new-modal-txt');
  assert.equal(newTxt.startTime, 16.5);
  assert.equal(newTxt.parentId, newBtn.id);
});

test('instantiatePrefab: handles legacy flat prefab gracefully', () => {
  const legacyPrefab = {
    id: 'legacy-1',
    name: 'Old Badge Prefab',
    duration: 4,
    components: [{ type: 'text', text: 'Hello' }],
  };

  const instantiated = instantiatePrefabOnTimeline(legacyPrefab, 2, 'track-2');
  assert.equal(instantiated.length, 1);
  assert.equal(instantiated[0].name, 'Old Badge');
  assert.equal(instantiated[0].startTime, 2);
  assert.equal(instantiated[0].duration, 4);
  assert.equal(instantiated[0].trackId, 'track-2');
  assert.equal(instantiated[0].parentId, null);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
