import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FEATURED_TRANSITIONS,
  ALL_GL_TRANSITIONS,
  getTransitionPreset,
  GL_CATEGORIES,
} from '../src/engine/glTransitions.js';
import { createTransitionComponent, RENDERER_REGISTRY } from '../src/engine/ecs.js';
import { computeActiveEntitiesAtTime } from '../src/engine/renderPipeline.js';

test('GL Transitions catalog is properly loaded', () => {
  assert.ok(FEATURED_TRANSITIONS.length >= 10, 'Has at least 10 featured presets');
  assert.ok(ALL_GL_TRANSITIONS.length >= 120, 'Has full 125+ library from gl-transitions');
  assert.ok(GL_CATEGORIES.includes('Glitch & Sci-Fi'), 'Categories include Glitch & Sci-Fi');

  const glitch = getTransitionPreset('glitchMemories');
  assert.equal(glitch.id, 'glitchMemories');
  assert.ok(glitch.glsl.includes('vec4 transition'));

  const zoom = getTransitionPreset('crossZoom');
  assert.equal(zoom.id, 'crossZoom');

  const unknown = getTransitionPreset('doesNotExist');
  assert.ok(unknown, 'Falls back safely to default preset');
});

test('createTransitionComponent initializes with valid defaults', () => {
  assert.ok(RENDERER_REGISTRY.TransitionComponent, 'TransitionComponent is registered in RENDERER_REGISTRY');
  const comp = createTransitionComponent();
  assert.equal(comp.type, 'TransitionComponent');
  assert.equal(comp.enabled, true);
  assert.equal(comp.transitionIn.enabled, true);
  assert.equal(comp.transitionIn.preset, 'glitchMemories');
  assert.equal(comp.transitionIn.duration, 0.8);
  assert.equal(comp.transitionOut.enabled, false);
});

test('computeActiveEntitiesAtTime resolves transitionState during transition window', () => {
  const tracks = [{ id: 'track-1', visible: true, locked: false }];
  const entity = {
    id: 'e1',
    name: 'Test Clip',
    trackId: 'track-1',
    startTime: 2.0,
    duration: 5.0,
    components: [
      { type: 'Transform', x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      createTransitionComponent({
        transitionIn: { enabled: true, preset: 'glitchMemories', duration: 1.0 },
        transitionOut: { enabled: true, preset: 'crossZoom', duration: 1.0 },
      }),
    ],
  };

  // 1. At t=2.5s (0.5s into clip): transitionIn is active at progress 0.5
  const midIn = computeActiveEntitiesAtTime({ entities: [entity], tracks, time: 2.5, fps: 30 });
  assert.equal(midIn.length, 1);
  assert.ok(midIn[0].transitionState, 'transitionState should be active');
  assert.equal(midIn[0].transitionState.type, 'in');
  assert.equal(midIn[0].transitionState.presetId, 'glitchMemories');
  assert.ok(Math.abs(midIn[0].transitionState.progress - 0.5) < 0.001);

  // 2. At t=4.0s (2.0s into clip): middle of clip, no transition
  const midClip = computeActiveEntitiesAtTime({ entities: [entity], tracks, time: 4.0, fps: 30 });
  assert.equal(midClip.length, 1);
  assert.equal(midClip[0].transitionState, null, 'No transition should be active mid-clip');

  // 3. At t=6.5s (4.5s into clip, 0.5s before end at 7.0s): transitionOut is active at progress 0.5
  const midOut = computeActiveEntitiesAtTime({ entities: [entity], tracks, time: 6.5, fps: 30 });
  assert.equal(midOut.length, 1);
  assert.ok(midOut[0].transitionState, 'transitionState should be active for out');
  assert.equal(midOut[0].transitionState.type, 'out');
  assert.equal(midOut[0].transitionState.presetId, 'crossZoom');
  assert.ok(Math.abs(midOut[0].transitionState.progress - 0.5) < 0.001);
});
