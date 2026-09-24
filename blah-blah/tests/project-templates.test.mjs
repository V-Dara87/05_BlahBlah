import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TEMPLATE_ID,
  PROJECT_TEMPLATES,
  buildTemplateProjectDefaults,
  buildTemplateResolution,
  buildTemplateTracks,
  getProjectTemplate,
  matchProjectTemplate,
  resolveProjectTemplate,
} from '../src/services/projectTemplates.js';
import { RESOLUTION_PRESETS } from '../src/types.js';

test('the template gallery is complete and self-describing', () => {
  assert.ok(PROJECT_TEMPLATES.length >= 6, 'enough templates to be worth a gallery');
  assert.equal(new Set(PROJECT_TEMPLATES.map((t) => t.id)).size, PROJECT_TEMPLATES.length, 'ids are unique');

  for (const template of PROJECT_TEMPLATES) {
    assert.ok(template.label, `${template.id}: has a label`);
    assert.ok(template.tagline, `${template.id}: has a tagline`);
    assert.ok(template.description && template.description.length > 30, `${template.id}: explains itself`);
    assert.ok(template.icon, `${template.id}: names an icon`);
    assert.ok(Array.isArray(template.tracks) && template.tracks.length >= 3, `${template.id}: has tracks`);
    assert.ok(template.resolution?.width > 0 && template.resolution?.height > 0, `${template.id}: has a canvas`);
    assert.ok((template.keywords || []).length > 0, `${template.id}: is searchable`);
  }

  // The blank template IS the app's original default, so someone who ignores
  // the gallery gets exactly what they got before it existed.
  const blank = getProjectTemplate('blank');
  assert.ok(blank, 'there is a blank template');
  assert.equal(blank.resolution.width, 1920);
  assert.equal(blank.resolution.height, 1080);
  assert.equal(blank.tracks.length, 4);
  assert.deepEqual(blank.tracks, ['Track 1', 'Track 2', 'Track 3', 'Track 4']);
  assert.equal(DEFAULT_TEMPLATE_ID, 'blank');
});

test('every template canvas is one the resolution picker can show', () => {
  // Otherwise the modal's resolution dropdown would render a value that is not
  // in its own option list.
  for (const template of PROJECT_TEMPLATES) {
    const match = RESOLUTION_PRESETS.some(
      (preset) => preset.width === template.resolution.width && preset.height === template.resolution.height
    );
    assert.ok(match, `${template.id}: ${template.resolution.width}x${template.resolution.height} is a preset`);
  }
});

test('buildTemplateTracks produces real, writable tracks', () => {
  for (const template of PROJECT_TEMPLATES) {
    const tracks = buildTemplateTracks(template);
    assert.equal(tracks.length, template.tracks.length);
    assert.equal(new Set(tracks.map((t) => t.id)).size, tracks.length, `${template.id}: ids are unique`);
    assert.deepEqual(tracks.map((t) => t.name), template.tracks, `${template.id}: names are kept in order`);

    for (const track of tracks) {
      // Unified tracks: media and GameObjects live on any track, so every track
      // is a 'layer' and templates differ by name and count only.
      assert.equal(track.type, 'layer');
      assert.equal(track.parentTrackId, null);
      assert.equal(track.muted, false);
      assert.equal(track.solo, false);
      assert.equal(track.locked, false);
      assert.equal(track.visible, true);
      assert.equal(track.volume, 1.0);
    }

    // Deterministic ids: a project created from a template is reproducible, and
    // a brand-new project has no clips referencing them yet.
    assert.equal(tracks[0].id, 'track-1');
  }

  // Calling it twice must not hand out shared objects.
  const first = buildTemplateTracks(getProjectTemplate('tutorial'));
  const second = buildTemplateTracks(getProjectTemplate('tutorial'));
  first[0].name = 'mutated';
  assert.equal(second[0].name, 'Footage');
});

test('buildTemplateResolution falls back instead of producing a broken canvas', () => {
  assert.deepEqual(buildTemplateResolution(getProjectTemplate('short')), { width: 1080, height: 1920 });
  assert.deepEqual(buildTemplateResolution(null), { width: 1920, height: 1080 });
  assert.deepEqual(buildTemplateResolution({ resolution: { width: 0, height: -4 } }), { width: 1920, height: 1080 });
  assert.deepEqual(buildTemplateResolution({ resolution: { width: 12.6, height: 7.2 } }), { width: 13, height: 7 });
});

test('an unknown template id resolves to the default rather than nothing', () => {
  assert.equal(resolveProjectTemplate('nope').id, DEFAULT_TEMPLATE_ID);
  assert.equal(resolveProjectTemplate(undefined).id, DEFAULT_TEMPLATE_ID);
  assert.equal(getProjectTemplate('nope'), undefined);

  // buildTemplateTracks with junk falls back the same way, so the create flow
  // can never write a project with no tracks at all.
  const fallback = buildTemplateTracks({ id: 'nope', tracks: 'not-an-array' });
  assert.equal(fallback.length, 4);

  const defaults = buildTemplateProjectDefaults('deleted-template');
  assert.equal(defaults.template.id, DEFAULT_TEMPLATE_ID);
  assert.equal(defaults.tracks.length, 4);
  assert.deepEqual(defaults.resolution, { width: 1920, height: 1080 });
});

test('templates are searchable by their own words', () => {
  const short = getProjectTemplate('short');
  assert.ok(matchProjectTemplate(short, ''));
  assert.ok(matchProjectTemplate(short, 'reels'));
  assert.ok(matchProjectTemplate(short, '9:16'));
  assert.ok(matchProjectTemplate(short, 'VERTICAL'), 'matching is case-insensitive');
  assert.ok(!matchProjectTemplate(short, 'podcast'));

  // Every template must be findable by its own id, which is what the gallery's
  // keyboard/deep-link paths rely on.
  for (const template of PROJECT_TEMPLATES) {
    assert.ok(matchProjectTemplate(template, template.id), `${template.id} matches its own id`);
  }
});
