import test from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage for Node test runner
const storage = {};
global.localStorage = {
  getItem: (key) => storage[key] ?? null,
  setItem: (key, val) => { storage[key] = String(val); },
  removeItem: (key) => { delete storage[key]; },
  clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
};

import {
  loadManifest,
  listPackages,
  addCustomPackage,
  removeCustomPackage,
  isPackageInstalled,
  getInstalledPackagesRegistry,
  saveInstalledPackagesRegistry,
  getPackagePath,
} from '../src/services/packageManager.js';
import { WHISPER_LANGUAGES, getRecommendedPackageFilterForLanguage } from '../src/data/whisperLanguages.js';
import { resolveClipSourcePath } from '../src/engine/subtitleAutoGenerate.js';

test('PackageManager - loads built-in manifest correctly', async () => {
  const manifest = await loadManifest();
  assert.ok(Array.isArray(manifest));
  assert.ok(manifest.length >= 6);

  const tiny = manifest.find((p) => p.id === 'whisper-tiny');
  assert.ok(tiny);
  assert.equal(tiny.category, 'whisper-model-official');
  assert.equal(tiny.sizeBytes, 77691713);
  assert.equal(tiny.sha256, 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21');

  const khmer = manifest.find((p) => p.id === 'whisper-khmer-small');
  assert.ok(khmer);
  assert.equal(khmer.category, 'whisper-model-khmer');
  assert.ok(khmer.tags.includes('km'));
});

test('PackageManager - filters packages by category and tag', async () => {
  const official = await listPackages({ category: 'whisper-model-official' });
  assert.ok(official.length >= 5);
  assert.ok(official.every((p) => p.category === 'whisper-model-official'));

  const khmerList = await listPackages({ category: 'whisper-model-khmer' });
  assert.equal(khmerList.length, 1);
  assert.equal(khmerList[0].id, 'whisper-khmer-small');

  const japanese = await listPackages({ tag: 'ja' });
  assert.ok(japanese.length >= 4);

  const scriptLibs = await listPackages({ category: 'script-library' });
  assert.ok(scriptLibs.length >= 4);
  assert.ok(scriptLibs.some((p) => p.id === 'npm-three' && p.packageName === 'three'));
  assert.ok(scriptLibs.some((p) => p.id === 'npm-gsap' && p.sampleCode));

  const compPacks = await listPackages({ category: 'component-pack' });
  assert.ok(compPacks.length >= 2);
  assert.ok(compPacks.some((p) => p.id === 'pack-title-card' && p.componentName === 'TitleCard.jsx'));
});

test('PackageManager - custom package add, list, and removal', async () => {
  const custom = await addCustomPackage({
    displayName: 'My Fine-tuned Model',
    url: 'https://example.com/models/custom-model.bin',
    category: 'custom-model',
    tags: ['custom', 'test'],
    description: 'A test custom model',
  });

  assert.ok(custom.id.startsWith('custom-'));
  assert.equal(custom.displayName, 'My Fine-tuned Model');
  assert.equal(custom.isCustom, true);

  const listAfterAdd = await listPackages({ category: 'custom-model' });
  assert.ok(listAfterAdd.some((p) => p.id === custom.id));

  await removeCustomPackage(custom.id);
  const listAfterRemove = await listPackages({ category: 'custom-model' });
  assert.ok(!listAfterRemove.some((p) => p.id === custom.id));
});

test('PackageManager - installed registry tracking', async () => {
  assert.equal(await isPackageInstalled('whisper-tiny'), false);

  const reg = await getInstalledPackagesRegistry();
  reg['whisper-tiny'] = {
    id: 'whisper-tiny',
    displayName: 'Whisper Tiny',
    installPath: 'models/whisper/ggml-tiny.bin',
    installedAt: Date.now(),
  };
  await saveInstalledPackagesRegistry(reg);

  assert.equal(await isPackageInstalled('whisper-tiny'), true);
  const path = await getPackagePath('whisper-tiny');
  assert.equal(path, 'models/whisper/ggml-tiny.bin');

  // Cleanup
  delete reg['whisper-tiny'];
  await saveInstalledPackagesRegistry(reg);
  assert.equal(await isPackageInstalled('whisper-tiny'), false);
});

test('WhisperLanguages - mappings and recommendation filters', () => {
  assert.ok(Array.isArray(WHISPER_LANGUAGES));
  assert.ok(WHISPER_LANGUAGES.some((l) => l.code === 'en'));
  assert.ok(WHISPER_LANGUAGES.some((l) => l.code === 'ja'));
  assert.ok(WHISPER_LANGUAGES.some((l) => l.code === 'km'));

  const kmFilter = getRecommendedPackageFilterForLanguage('km');
  assert.equal(kmFilter.category, 'whisper-model-khmer');
  assert.equal(kmFilter.tag, 'km');

  const jaFilter = getRecommendedPackageFilterForLanguage('ja');
  assert.equal(jaFilter.tag, 'ja');
});

test('SubtitleAutoGenerate - resolveClipSourcePath', () => {
  const entity1 = {
    filePath: 'D:/media/sample.mp4',
  };
  assert.equal(resolveClipSourcePath(entity1), 'D:/media/sample.mp4');

  const entity2 = {
    components: [{ type: 'VideoRenderer', src: 'blob:http://localhost/test' }],
  };
  const mediaAssets = [
    { url: 'blob:http://localhost/test', path: 'C:/assets/interview.mp4' },
  ];
  assert.equal(resolveClipSourcePath(entity2, mediaAssets), 'C:/assets/interview.mp4');

  const entity3 = {
    components: [{ type: 'AudioSource', src: 'C:\\recordings\\voiceover.wav' }],
  };
  assert.equal(resolveClipSourcePath(entity3), 'C:\\recordings\\voiceover.wav');
});
