import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getByPath,
  setByPath,
  resolveScriptGizmos,
  updateGizmoProperty,
  gizmoToCanvasCoords,
  canvasToGizmoCoords,
} from '../src/engine/gizmoEngine.js';
import { CanvasComponent } from '../packages/blahblah-sdk/index.js';

test('getByPath and setByPath handles nested structures and arrays immutably', () => {
  const state = {
    title: 'Chart',
    nodes: [
      { id: 'n1', x: 100, y: 150 },
      { id: 'n2', x: 300, y: 200 },
    ],
    config: {
      center: { x: 50, y: 80 },
    },
  };

  assert.equal(getByPath(state, 'title'), 'Chart');
  assert.equal(getByPath(state, 'nodes[0].x'), 100);
  assert.equal(getByPath(state, 'nodes[1].y'), 200);
  assert.equal(getByPath(state, 'config.center.x'), 50);

  const updated = setByPath(state, 'nodes[0].x', 120);
  assert.equal(updated.nodes[0].x, 120);
  assert.equal(state.nodes[0].x, 100); // Original unchanged

  const updatedCenter = setByPath(state, 'config.center', { x: 99, y: 99 });
  assert.deepEqual(updatedCenter.config.center, { x: 99, y: 99 });
  assert.equal(state.config.center.x, 50);
});

test('a key selector targets the matching array item, not its index', () => {
  const state = {
    nodes: [
      { id: 'n1', x: 100 },
      { id: 'n2', x: 300 },
    ],
  };

  assert.equal(getByPath(state, 'nodes[id=n2].x'), 300);
  assert.equal(getByPath(state, 'nodes[id=missing].x'), undefined);

  const updated = setByPath(state, 'nodes[id=n1].x', 120);
  assert.equal(updated.nodes[0].x, 120);
  assert.equal(state.nodes[0].x, 100, 'original left untouched');

  // Reordering the array does not change which item a key path writes to.
  const reordered = { nodes: [{ id: 'n2', x: 300 }, { id: 'n1', x: 100 }] };
  assert.equal(setByPath(reordered, 'nodes[id=n1].x', 999).nodes[1].x, 999);

  // An unmatched selector is a no-op, never a wrong-item write.
  assert.equal(setByPath(state, 'nodes[id=missing].x', 1), state);
});

test('array gizmos use the item id as a stable propPath when present', () => {
  const items = [
    { id: 'pin1', x: 1, y: 2 },
    { id: 'pin2', x: 3, y: 4 },
  ];
  const gizmos = resolveScriptGizmos({
    schema: [{ name: 'items', type: 'struct[]', label: 'Items', gizmo: true, defaultVal: items }],
    props: { items },
  });
  assert.equal(gizmos.length, 2);
  assert.equal(gizmos[0].propPath, 'items[id=pin1]');
  assert.equal(gizmos[1].propPath, 'items[id=pin2]');
});

test('resolveScriptGizmos calls getGizmos dynamic hook if implemented', () => {
  const instance = {
    getGizmos({ props, canvasWidth, canvasHeight }) {
      return props.items.map((it, idx) => ({
        id: it.id,
        x: it.x,
        y: it.y,
        axes: it.isSlider ? 'x' : 'xy',
        size: it.width < 30 ? 'compact' : 'normal',
        label: it.name,
      }));
    },
  };

  const props = {
    items: [
      { id: 'pin1', x: 50, y: 100, width: 20, isSlider: true, name: 'Start Slider' },
      { id: 'pin2', x: 400, y: 300, width: 60, isSlider: false, name: 'Node Center' },
    ],
  };

  const gizmos = resolveScriptGizmos({
    instance,
    props,
    canvasWidth: 1920,
    canvasHeight: 1080,
  });

  assert.equal(gizmos.length, 2);
  assert.equal(gizmos[0].id, 'pin1');
  assert.equal(gizmos[0].axes, 'x'); // Overridden to X axis
  assert.equal(gizmos[0].size, 'compact'); // Overridden to compact for small object
  assert.equal(gizmos[1].id, 'pin2');
  assert.equal(gizmos[1].axes, 'xy');
  assert.equal(gizmos[1].size, 'normal');
});

test('resolveScriptGizmos infers gizmos from static props schema', () => {
  const schema = {
    centerPoint: {
      type: 'point2d',
      default: { x: 200, y: 150 },
      gizmo: 'point',
    },
    timelineMarker: {
      type: 'number',
      default: 500,
      gizmo: { axis: 'x', size: 'compact' },
    },
  };

  const props = {
    centerPoint: { x: 250, y: 180 },
    timelineMarker: 650,
  };

  const gizmos = resolveScriptGizmos({
    schema,
    props,
    canvasWidth: 1920,
    canvasHeight: 1080,
  });

  assert.equal(gizmos.length, 2);
  const center = gizmos.find((g) => g.id === 'centerPoint');
  assert.ok(center);
  assert.equal(center.x, 250);
  assert.equal(center.y, 180);
  assert.equal(center.axes, 'xy');

  const marker = gizmos.find((g) => g.id === 'timelineMarker');
  assert.ok(marker);
  assert.equal(marker.x, 650);
  assert.equal(marker.axes, 'x');
  assert.equal(marker.size, 'compact');
});

test('updateGizmoProperty modifies static props when autoKey is off', () => {
  const entity = {
    id: 'ent-1',
    startTime: 0,
    components: [
      {
        type: 'ScriptComponent',
        scriptId: 'graph-script',
        props: {
          points: [
            { x: 100, y: 100 },
            { x: 300, y: 300 },
          ],
        },
      },
    ],
  };

  const gizmo = {
    id: 'pt-0',
    propPath: 'points[0]',
    axes: 'xy',
  };

  const patch = updateGizmoProperty({
    entity,
    scriptId: 'graph-script',
    gizmo,
    newX: 150,
    newY: 180,
    autoKeyEnabled: false,
    currentTime: 1.0,
  });

  assert.ok(patch);
  const updatedComp = patch.components.find((c) => c.scriptId === 'graph-script');
  assert.equal(updatedComp.props.points[0].x, 150);
  assert.equal(updatedComp.props.points[0].y, 180);
  assert.equal(updatedComp.props.points[1].x, 300); // Point 1 unchanged
  assert.equal(patch.keyframes, undefined); // No keyframes recorded
});

test('updateGizmoProperty creates keyframe when autoKey is on', () => {
  const entity = {
    id: 'ent-1',
    startTime: 0,
    components: [
      {
        type: 'ScriptComponent',
        scriptId: 'graph-script',
        props: {
          points: [
            { x: 100, y: 100 },
          ],
        },
      },
    ],
    keyframes: {},
  };

  const gizmo = {
    id: 'pt-0',
    propPath: 'points[0]',
    axes: 'xy',
  };

  const patch = updateGizmoProperty({
    entity,
    scriptId: 'graph-script',
    gizmo,
    newX: 220,
    newY: 340,
    autoKeyEnabled: true,
    currentTime: 2.0,
    fps: 30,
  });

  assert.ok(patch);
  assert.ok(patch.keyframes);
  const trackKfs = patch.keyframes['script:graph-script']?.points;
  assert.ok(trackKfs && trackKfs.length > 0);
  assert.equal(trackKfs[0].time, 2.0);
  assert.equal(trackKfs[0].value[0].x, 220);
  assert.equal(trackKfs[0].value[0].y, 340);
});

test('updateGizmoProperty respects axis constraint (axes: x)', () => {
  const entity = {
    id: 'ent-1',
    startTime: 0,
    components: [
      {
        type: 'ScriptComponent',
        scriptId: 'slider-script',
        props: {
          sliderPos: { x: 50, y: 200 },
        },
      },
    ],
  };

  const gizmo = {
    id: 'slider',
    propPath: 'sliderPos',
    axes: 'x', // Only X changes
  };

  const patch = updateGizmoProperty({
    entity,
    scriptId: 'slider-script',
    gizmo,
    newX: 180,
    newY: 999, // Should be ignored because axes is 'x'
    autoKeyEnabled: false,
  });

  assert.ok(patch);
  const updatedComp = patch.components.find((c) => c.scriptId === 'slider-script');
  assert.equal(updatedComp.props.sliderPos.x, 180);
  assert.equal(updatedComp.props.sliderPos.y, 200); // Unchanged Y
});

test('resolveScriptGizmos handles Array schema from extractScriptProps and struct with x, y', () => {
  const arraySchema = [
    {
      name: 'star',
      type: 'struct',
      label: 'Star Transform',
      fields: {
        x: { type: 'number', default: 960 },
        y: { type: 'number', default: 540 },
        scale: { type: 'number', default: 1 },
      },
      defaultVal: { x: 960, y: 540, scale: 1 },
    },
  ];

  const props = {
    star: { x: 400, y: 300, scale: 1.5 },
  };

  const gizmos = resolveScriptGizmos({
    schema: arraySchema,
    props,
    canvasWidth: 1920,
    canvasHeight: 1080,
  });

  assert.equal(gizmos.length, 1);
  assert.equal(gizmos[0].id, 'star');
  assert.equal(gizmos[0].x, 400);
  assert.equal(gizmos[0].y, 300);
  assert.equal(gizmos[0].propPath, 'star');
});

test('updateGizmoProperty updates struct x and y while preserving scale and extra fields', () => {
  const entity = {
    id: 'ent-star',
    startTime: 0,
    components: [
      {
        type: 'ScriptComponent',
        scriptId: 'star-script',
        props: {
          star: { x: 960, y: 540, scale: 2.5, points: 5, color: '#facc15' },
        },
      },
    ],
  };

  const gizmo = {
    id: 'star-gizmo',
    propPath: 'star',
    axes: 'xy',
  };

  const patch = updateGizmoProperty({
    entity,
    scriptId: 'star-script',
    gizmo,
    newX: 350,
    newY: 420,
    autoKeyEnabled: false,
  });

  assert.ok(patch);
  const updatedComp = patch.components.find((c) => c.scriptId === 'star-script');
  assert.equal(updatedComp.props.star.x, 350);
  assert.equal(updatedComp.props.star.y, 420);
  assert.equal(updatedComp.props.star.scale, 2.5); // Preserved!
  assert.equal(updatedComp.props.star.points, 5); // Preserved!
  assert.equal(updatedComp.props.star.color, '#facc15'); // Preserved!
});

test('resolveScriptGizmos and updateGizmoProperty handle array of multiple stars', () => {
  const starsArray = [
    { x: 100, y: 100, scale: 1.0, color: '#facc15' },
    { x: 300, y: 200, scale: 0.5, color: '#38bdf8' },
    { x: 600, y: 500, scale: 1.5, color: '#ec4899' },
  ];

  const arraySchema = [
    {
      name: 'stars',
      type: 'struct[]',
      label: 'Stars',
      gizmo: true,
      defaultVal: starsArray,
    },
  ];

  const gizmos = resolveScriptGizmos({
    schema: arraySchema,
    props: { stars: starsArray },
    canvasWidth: 1920,
    canvasHeight: 1080,
  });

  assert.equal(gizmos.length, 3);
  assert.equal(gizmos[0].x, 100);
  assert.equal(gizmos[0].propPath, 'stars[0]');
  assert.equal(gizmos[1].x, 300);
  assert.equal(gizmos[1].propPath, 'stars[1]');
  assert.equal(gizmos[2].x, 600);
  assert.equal(gizmos[2].propPath, 'stars[2]');

  // Update second star
  const entity = {
    id: 'ent-multistar',
    startTime: 0,
    components: [
      {
        type: 'ScriptComponent',
        scriptId: 'star-script',
        props: { stars: starsArray },
      },
    ],
  };

  const patch = updateGizmoProperty({
    entity,
    scriptId: 'star-script',
    gizmo: gizmos[1],
    newX: 350,
    newY: 250,
    autoKeyEnabled: false,
  });

  assert.ok(patch);
  const updatedComp = patch.components.find((c) => c.scriptId === 'star-script');
  assert.equal(updatedComp.props.stars[0].x, 100); // 0 unchanged
  assert.equal(updatedComp.props.stars[1].x, 350); // 1 updated
  assert.equal(updatedComp.props.stars[1].y, 250); // 1 updated
  assert.equal(updatedComp.props.stars[1].scale, 0.5); // scale preserved
  assert.equal(updatedComp.props.stars[2].x, 600); // 2 unchanged
});

test('local vs global transform coordinate space helpers', () => {
  const localGizmo = {
    id: 'star-local',
    x: -200,
    y: 150,
    space: 'local',
    rotation: 45,
    origin: 'center',
  };

  const canvasCoords = gizmoToCanvasCoords(localGizmo, 1920, 1080);
  assert.equal(canvasCoords.x, 960 - 200); // 760
  assert.equal(canvasCoords.y, 540 + 150); // 690

  const backToGizmo = canvasToGizmoCoords({ x: 760, y: 690 }, localGizmo, 1920, 1080);
  assert.equal(backToGizmo.x, -200);
  assert.equal(backToGizmo.y, 150);

  // Global gizmo (passthrough)
  const globalGizmo = {
    id: 'star-global',
    x: 500,
    y: 400,
    space: 'global',
  };
  assert.deepEqual(gizmoToCanvasCoords(globalGizmo, 1920, 1080), { x: 500, y: 400 });
  assert.deepEqual(canvasToGizmoCoords({ x: 500, y: 400 }, globalGizmo, 1920, 1080), { x: 500, y: 400 });
});

test('gizmo defaults to space local with (0,0) as exact canvas center', () => {
  const schema = {
    marker: {
      type: 'point2d',
      default: { x: 0, y: 0 },
      gizmo: true,
    },
  };

  const gizmos = resolveScriptGizmos({
    schema,
    props: { marker: { x: 0, y: 0 } },
    canvasWidth: 1920,
    canvasHeight: 1080,
  });

  assert.equal(gizmos.length, 1);
  assert.equal(gizmos[0].space, 'local');
  assert.equal(gizmos[0].origin, 'center');

  // Center coordinate (0, 0) maps to (960, 540)
  const screenPos = gizmoToCanvasCoords(gizmos[0], 1920, 1080);
  assert.deepEqual(screenPos, { x: 960, y: 540 });

  // And back
  const localPos = canvasToGizmoCoords(screenPos, gizmos[0], 1920, 1080);
  assert.deepEqual(localPos, { x: 0, y: 0 });
});

test('CanvasComponent toScreen and fromScreen helpers map (0,0) to center and vice-versa', () => {
  const comp = new CanvasComponent();
  comp.canvasWidth = 1920;
  comp.canvasHeight = 1080;

  // (0, 0) should be screen center (960, 540)
  assert.deepEqual(comp.toScreen(0, 0), { x: 960, y: 540 });
  assert.deepEqual(comp.toScreen(-100, 200), { x: 860, y: 740 });

  // Screen center (960, 540) should be (0, 0)
  assert.deepEqual(comp.fromScreen(960, 540), { x: 0, y: 0 });
  assert.deepEqual(comp.fromScreen(860, 740), { x: -100, y: 200 });
});

test('ScriptDocsModal includes Script Gizmos and CanvasComponent coordinate helpers', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const modalPath = path.resolve('src/components/modals/ScriptDocsModal.jsx');
  const content = fs.readFileSync(modalPath, 'utf8');

  // Verify SECTIONS includes Script gizmos
  assert.match(content, /id:\s*'gizmos',\s*label:\s*'Script gizmos'/);

  // Verify SCRIPT_API_DOCS_MARKDOWN includes the dedicated gizmo section
  assert.match(content, /## 5\. Script gizmos — interactive handles in preview/);
  assert.match(content, /getGizmos\(\{ props, time, canvasWidth, canvasHeight \}\)/);
  assert.match(content, /ScriptGizmoDef/);
  assert.match(content, /propPath/);

  // Verify CanvasComponent centerOrigin and toScreen/fromScreen helpers are documented
  assert.match(content, /CanvasComponent/);
  assert.match(content, /toScreen/);
  assert.match(content, /fromScreen/);
  assert.match(content, /centerOrigin/);
  assert.match(content, /restoreOrigin/);

  // Verify cheat sheet includes gizmo summary
  assert.match(content, /getGizmos\(.*\) →/);
});


