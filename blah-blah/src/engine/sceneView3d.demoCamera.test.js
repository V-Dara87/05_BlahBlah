// Demo Camera behaviour, tested at the Scene View seam (engine/sceneView3d.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneViewCamera } from './sceneView3d.js';

const VP = { width: 1920, height: 1080 };
const angleBetween = (a, b) => {
  const d = a.x * b.x + a.y * b.y + a.z * b.z;
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
};

test('Demo Camera orbiting towards straight-down does not flip the picture', () => {
  // The view must change smoothly while the elevation approaches the 89.9 clamp,
  // including at azimuths where the camera is not facing +Z.
  for (const azimuth of [0, 35, 90, 200]) {
    let prev = buildSceneViewCamera({ azimuth, elevation: 85, distance: 2400 }, VP);
    for (let el = 85.5; el <= 89.9; el += 0.5) {
      const cur = buildSceneViewCamera({ azimuth, elevation: el, distance: 2400 }, VP);
      const turn = Math.max(angleBetween(prev.right, cur.right), angleBetween(prev.up, cur.up));
      assert.ok(turn < 15, `azimuth ${azimuth}: view jumped ${turn.toFixed(1)} deg at elevation ${el}`);
      prev = cur;
    }
  }
});

// ── Match Project Camera ────────────────────────────────────────────────────
import { orbitStateFromCamera, projectEntitiesForSceneView } from './sceneView3d.js';
import { createDefaultCamera, project3DLayer, buildLayerMatrix } from './camera3d.js';
import { getLayerBox, getPivotBase } from './layerBox.js';

const BOX = { type: 'Shape', width: 300, height: 200 };

// Build an item the way renderPipeline.computeActiveEntitiesAtTime does,
// i.e. with poses resolved against the PROJECT camera.
function makeItem(entity, local, projectCamera, { parentMat = null } = {}) {
  const layerBox = getLayerBox(entity, { frameWidth: VP.width, frameHeight: VP.height });
  const pivotBase = getPivotBase(entity, { frameWidth: VP.width, frameHeight: VP.height });
  const projectedTransform = project3DLayer({ ...local, is3D: true }, projectCamera, VP, {
    parentMatrix: parentMat,
    pivotBase,
    box: layerBox,
  });
  return { entity, transform: local, localTransform: local, is3D: true, layerBox, pivotBase, projectedTransform };
}

const projectCamera = createDefaultCamera({
  position: { x: 300, y: -200, z: -1500 },
  targetOffset: { x: -150, y: 80, z: 1000 },
  roll: 12,
  fov: 40,
  zoom: 1.2,
});
const local3D = { rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 };
const layers = {
  plain: (cam) => makeItem({ id: 'a', components: [BOX] }, { ...local3D, x: 100, y: 0, z: 200, rotationY: 40 }, cam),
  rotated: (cam) => makeItem({ id: 'b', components: [BOX] }, { ...local3D, x: -250, y: 120, z: -300, rotationX: 20, rotationZ: 15 }, cam),
  towardsPOI: (cam) => makeItem({ id: 'c', components: [BOX] }, { ...local3D, x: 400, y: 50, z: 100, autoOrient: 'towardsPOI' }, cam),
  child: (cam) => makeItem({ id: 'd', parentId: 'p', components: [BOX] }, { ...local3D, x: 0, y: 0, z: 0 }, cam,
    { parentMat: buildLayerMatrix({ x: 300, y: 0, z: 0 }, null, null) }),
};

for (const [name, make] of Object.entries(layers)) {
  test(`Match Project Camera: Scene View equals the normal preview (${name})`, () => {
    const item = make(projectCamera);
    const demo = buildSceneViewCamera(orbitStateFromCamera(projectCamera), VP);
    const [shown] = projectEntitiesForSceneView([item], demo, VP);
    const expected = item.projectedTransform.quad.corners; // what the normal preview draws
    const actual = shown.projectedTransform.quad.corners;
    for (let i = 0; i < 4; i++) {
      const err = Math.hypot(expected[i][0] - actual[i][0], expected[i][1] - actual[i][1]);
      assert.ok(err < 0.5, `corner ${i} is ${err.toFixed(2)} px off`);
    }
  });
}

test('Moving the Demo Camera never moves a layer in the world', () => {
  const item = layers.towardsPOI(projectCamera);
  const elsewhere = buildSceneViewCamera({ azimuth: 140, elevation: 40, distance: 3000, target: { x: 50, y: 0, z: 0 } }, VP);
  const [shown] = projectEntitiesForSceneView([item], elsewhere, VP);
  assert.deepEqual(shown.projectedTransform.modelMatrix, item.projectedTransform.modelMatrix);
});

test('Match Project Camera with no project camera uses the default camera', () => {
  const state = orbitStateFromCamera(null);
  const demo = buildSceneViewCamera(state, VP);
  assert.ok(Math.abs(demo.eye.z - -1000) < 1e-6 && Math.abs(demo.eye.x) < 1e-6 && Math.abs(demo.eye.y) < 1e-6);
});