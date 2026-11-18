// Regression: in the Scene View, a layer's rendered quad and its wireframe must coincide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneViewCamera, buildEntitiesWireframes, projectEntitiesForSceneView, SCENE_VIEW_PRESETS } from './sceneView3d.js';
import { project3DLayer, createDefaultCamera, buildLayerMatrix } from './camera3d.js';
import { getLayerBox, getPivotBase } from './layerBox.js';

const VP = { width: 1920, height: 1080 };
const cam = buildSceneViewCamera(SCENE_VIEW_PRESETS.perspective, VP);

// Build an item exactly like renderPipeline.computeActiveEntitiesAtTime does
function makeItem(entity, local, { parentMat = null } = {}) {
  const is3D = Boolean(local.is3D);
  const layerBox = getLayerBox(entity, { frameWidth: VP.width, frameHeight: VP.height });
  const pivotBase = getPivotBase(entity, { frameWidth: VP.width, frameHeight: VP.height });
  const projectedTransform = is3D
    ? project3DLayer({ ...local, is3D: true }, createDefaultCamera(), VP, { parentMatrix: parentMat, pivotBase, box: layerBox })
    : null;
  return { entity, transform: local, localTransform: local, is3D, layerBox, projectedTransform };
}

function compare(item) {
  const projected = projectEntitiesForSceneView([item], cam, VP);
  const vis = projected[0].projectedTransform.quad.corners;
  const wf = buildEntitiesWireframes(projected, cam, null)[0].segments;
  assert.equal(wf.length, 4, 'wireframe should have 4 segments');
  const wfCorners = [[wf[0].sx1, wf[0].sy1], [wf[1].sx1, wf[1].sy1], [wf[2].sx1, wf[2].sy1], [wf[3].sx1, wf[3].sy1]];
  let worst = 0;
  for (let i = 0; i < 4; i++) worst = Math.max(worst, Math.hypot(vis[i][0] - wfCorners[i][0], vis[i][1] - wfCorners[i][1]));
  return worst;
}

const box = { type: 'Shape', width: 300, height: 200 };
const cases = {
  '2D plain (x=0,y=0)':               makeItem({ id: 'a', components: [box] }, { x: 0, y: 0, z: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
  '2D moved+rotated+scaled':          makeItem({ id: 'b', components: [box] }, { x: 200, y: 100, z: 0, rotation: 30, scaleX: 0.5, scaleY: 2 }),
  '2D with pivot':                    makeItem({ id: 'c', components: [box] }, { x: 0, y: 0, z: 0, rotation: 45, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5 }),
  '3D plain':                         makeItem({ id: 'd', components: [box] }, { x: 100, y: 0, z: 200, rotationX: 0, rotationY: 40, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, is3D: true }),
  '3D child of parent at x=+300':     makeItem({ id: 'e', parentId: 'p', components: [box] }, { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, is3D: true },
                                        { parentMat: buildLayerMatrix({ x: 300, y: 0, z: 0 }, null, null) }),
};

for (const [name, item] of Object.entries(cases)) {
  test(`visual == wireframe: ${name}`, () => {
    const err = compare(item);
    assert.ok(err < 0.5, `corner mismatch ${err.toFixed(1)} px`);
  });
}