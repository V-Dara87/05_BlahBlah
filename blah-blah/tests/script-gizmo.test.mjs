import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getByPath,
  setByPath,
  resolveScriptGizmos,
  updateGizmoProperty,
} from '../src/engine/gizmoEngine.js';

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
