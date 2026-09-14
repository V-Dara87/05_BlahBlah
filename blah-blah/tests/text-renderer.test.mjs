import assert from 'node:assert/strict';
import { createPhrase, createSubtitleTrackComponent } from '../src/engine/subtitleTrack.js';
import {
  resolveTextRendererText,
  cssFontFamily,
  isTextDrivenBySubtitle,
} from '../src/engine/textRenderer.js';

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

console.log('\nTextRenderer display-text tests\n');

test('cssFontFamily quotes names with spaces', () => {
  assert.equal(cssFontFamily('Inter'), 'Inter, sans-serif');
  assert.equal(cssFontFamily('Times New Roman'), '"Times New Roman", sans-serif');
});

test('static text when no subtitle is attached', () => {
  const entity = {
    id: 't1',
    name: 'Clip',
    startTime: 0,
    components: [{ type: 'TextRenderer', text: 'Hello' }],
  };
  const textComp = entity.components[0];
  assert.equal(resolveTextRendererText(textComp, entity, [entity], 1), 'Hello');
  assert.equal(isTextDrivenBySubtitle(textComp, entity), false);
});

test('same-entity SubtitleTrack drives the text', () => {
  const phrases = [
    createPhrase({ startTime: 0, endTime: 2, text: 'First' }),
    createPhrase({ startTime: 2, endTime: 4, text: 'Second' }),
  ];
  const entity = {
    id: 't1',
    name: 'Clip',
    startTime: 0,
    components: [
      { type: 'TextRenderer', text: 'ignored' },
      createSubtitleTrackComponent({ phrases }),
    ],
  };
  const textComp = entity.components[0];
  assert.equal(isTextDrivenBySubtitle(textComp, entity), true);
  assert.equal(resolveTextRendererText(textComp, entity, [entity], 0.5), 'First');
  assert.equal(resolveTextRendererText(textComp, entity, [entity], 2.5), 'Second');
});

test('subtitleSourceId points at another clip', () => {
  const source = {
    id: 'sub',
    name: 'Subs',
    startTime: 10,
    components: [
      createSubtitleTrackComponent({
        phrases: [createPhrase({ startTime: 0, endTime: 5, text: 'From source' })],
      }),
    ],
  };
  const entity = {
    id: 't1',
    name: 'Text',
    startTime: 0,
    components: [{ type: 'TextRenderer', text: 'static', subtitleSourceId: 'sub' }],
  };
  const textComp = entity.components[0];
  assert.equal(resolveTextRendererText(textComp, entity, [entity, source], 11), 'From source');
  assert.equal(resolveTextRendererText(textComp, entity, [entity, source], 0), '');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
