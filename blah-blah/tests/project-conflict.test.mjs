import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTextHash,
  ProjectConflictError,
  checkRevisionConflict,
  resolveExternalChangeAction,
} from '../src/utils/projectRevision.js';
import { hashText } from '../packages/blahblah-core/src/fsutil.js';

test('computeTextHash matches SHA-1 vectors and blahblah-core hashText', async () => {
  const sample1 = 'hello';
  const sample2 = JSON.stringify({ name: 'Test', schemaVersion: 1 }, null, 2);
  const sampleEmpty = '';

  const hash1 = await computeTextHash(sample1);
  assert.equal(hash1, hashText(sample1));
  assert.equal(hash1, 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');

  const hash2 = await computeTextHash(sample2);
  assert.equal(hash2, hashText(sample2));

  const hashEmpty = await computeTextHash(sampleEmpty);
  assert.equal(hashEmpty, hashText(sampleEmpty));
  assert.equal(hashEmpty, 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
});

test('ProjectConflictError carries proper error name and code', () => {
  const err = new ProjectConflictError('Conflict occurred');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'ProjectConflictError');
  assert.equal(err.code, 'EPROJECT_CONFLICT');
  assert.equal(err.message, 'Conflict occurred');
});

test('checkRevisionConflict correctly detects external divergence', async () => {
  const originalText = JSON.stringify({ name: 'Original', version: '1.0' });
  const revision = await computeTextHash(originalText);

  // When disk matches recorded revision -> no conflict
  const inSync = await checkRevisionConflict({
    currentRevision: revision,
    diskText: originalText,
  });
  assert.equal(inSync, false);

  // When disk was modified externally -> conflict detected
  const modifiedDiskText = JSON.stringify({ name: 'External Edit', version: '1.0' });
  const hasConflict = await checkRevisionConflict({
    currentRevision: revision,
    diskText: modifiedDiskText,
  });
  assert.equal(hasConflict, true);

  // When revision is null/empty -> no conflict check possible
  const noRev = await checkRevisionConflict({
    currentRevision: null,
    diskText: modifiedDiskText,
  });
  assert.equal(noRev, false);
});

test('resolveExternalChangeAction policy handles clean vs dirty editor states', () => {
  // If there is no conflict, do nothing
  assert.equal(resolveExternalChangeAction({ saveStatus: 'saved', hasConflict: false }), 'ignore');
  assert.equal(resolveExternalChangeAction({ saveStatus: 'unsaved', hasConflict: false }), 'ignore');

  // If there is conflict and editor is clean (saved), reload silently
  assert.equal(resolveExternalChangeAction({ saveStatus: 'saved', hasConflict: true }), 'reload');

  // If there is conflict and editor is dirty (unsaved or in-memory), prompt user to prevent silent data loss
  assert.equal(resolveExternalChangeAction({ saveStatus: 'unsaved', hasConflict: true }), 'prompt');
  assert.equal(resolveExternalChangeAction({ saveStatus: 'in-memory', hasConflict: true }), 'prompt');
});
