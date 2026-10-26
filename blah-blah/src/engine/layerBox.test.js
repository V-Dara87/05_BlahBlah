import test from 'node:test';
import assert from 'node:assert/strict';
import { getLayerBox } from './layerBox.js';

const FRAME = { frameWidth: 1920, frameHeight: 1080 };

test('layerBox - a video layer is the whole frame', () => {
  assert.deepEqual(getLayerBox({ type: 'video' }, FRAME), { width: 1920, height: 1080 });
  // The component is what the renderer looks at, whatever `type` says.
  assert.deepEqual(
    getLayerBox({ components: [{ type: 'VideoRenderer', src: 'a.mp4' }] }, FRAME),
    { width: 1920, height: 1080 }
  );
});

test('layerBox - a shape layer is its authored size', () => {
  const box = getLayerBox({ components: [{ type: 'ShapeRenderer', width: 320, height: 180 }] }, FRAME);
  assert.deepEqual(box, { width: 320, height: 180 });
});

test('layerBox - layers with no authored size use the frame', () => {
  // Text, react and canvas scripts are laid out centred on the frame with no
  // fixed size, so the frame is the box they are rasterized into. Using a
  // guessed 180x180 here used to clip long text lines when the exporter warped
  // the layer.
  assert.deepEqual(getLayerBox({ components: [{ type: 'TextRenderer' }] }, FRAME), {
    width: 1920,
    height: 1080,
  });
  assert.deepEqual(getLayerBox({ components: [] }, FRAME), { width: 1920, height: 1080 });
});

test('pivotBase - matches the preview: authored size, frame for canvas scripts, else 180', async () => {
  const { getPivotBase } = await import('./layerBox.js');

  assert.deepEqual(
    getPivotBase({ components: [{ type: 'ShapeRenderer', width: 320, height: 180 }] }, FRAME),
    { width: 320, height: 180 }
  );

  const canvasClip = {
    components: [{ type: 'ScriptComponent', scriptId: 's1', enabled: true }],
  };
  assert.deepEqual(
    getPivotBase(canvasClip, { ...FRAME, scriptKindOf: () => 'canvas' }),
    { width: 1920, height: 1080 }
  );

  // A text layer has always pivoted against 180px in the preview; a react
  // script is shrink-to-fit the same way.
  assert.deepEqual(getPivotBase({ components: [{ type: 'TextRenderer' }] }, FRAME), {
    width: 180,
    height: 180,
  });
  assert.deepEqual(
    getPivotBase({ components: [{ type: 'ScriptComponent', scriptId: 's1' }] }, { ...FRAME, scriptKindOf: () => 'react' }),
    { width: 180, height: 180 }
  );
  // A disabled canvas script does not change the pivot base.
  assert.deepEqual(
    getPivotBase(
      { components: [{ type: 'ScriptComponent', scriptId: 's1', enabled: false }] },
      { ...FRAME, scriptKindOf: () => 'canvas' }
    ),
    { width: 180, height: 180 }
  );
});
