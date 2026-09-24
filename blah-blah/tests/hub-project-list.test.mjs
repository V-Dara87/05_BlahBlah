import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_PROJECTS_ID,
  DEFAULT_PROJECT_SORT,
  PROJECT_SORTS,
  UNFILED_PROJECTS_ID,
  buildProjectGroups,
  countProjectsPerFolder,
  matchesProjectQuery,
  resolveProjectFolderId,
  sortProjects,
} from '../src/utils/hubProjectList.js';

const FOLDERS = [
  { id: 'f1', name: 'Client Work', createdAt: 1 },
  { id: 'f2', name: 'Tutorials', createdAt: 2 },
];

const PROJECTS = [
  { id: 'p1', name: 'intro-animation', path: 'D:/videos/intro-animation', createdAt: 10, lastOpenedAt: 100, folderId: 'f1' },
  { id: 'p2', name: 'lesson-one', path: 'D:/videos/lesson-one', createdAt: 20, lastOpenedAt: 90, folderId: 'f2' },
  { id: 'p3', name: 'promo-cut', path: 'D:/clients/promo-cut', createdAt: 30, lastOpenedAt: 80, folderId: null },
  { id: 'p4', name: 'untitled', path: 'D:/videos/untitled', createdAt: 40, lastOpenedAt: 70, folderId: 'f1' },
];

test('the query matches the name AND the path', () => {
  assert.ok(matchesProjectQuery(PROJECTS[0], ''));
  assert.ok(matchesProjectQuery(PROJECTS[0], '  '), 'a whitespace-only query matches everything');
  assert.ok(matchesProjectQuery(PROJECTS[0], 'INTRO'), 'case-insensitive');
  // The name alone is often generic, so the path has to be searchable too.
  assert.ok(matchesProjectQuery(PROJECTS[2], 'clients'));
  assert.ok(!matchesProjectQuery(PROJECTS[2], 'lesson'));
  assert.ok(matchesProjectQuery({ name: 'x' }, 'x'), 'a project with no path does not throw');
});

test('sorting covers every offered option', () => {
  assert.equal(PROJECT_SORTS.length, 3);
  assert.deepEqual(PROJECT_SORTS.map((s) => s.id), ['recent', 'created', 'name']);
  assert.equal(DEFAULT_PROJECT_SORT, 'recent');

  assert.deepEqual(sortProjects(PROJECTS).map((p) => p.id), ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(sortProjects(PROJECTS, 'created').map((p) => p.id), ['p4', 'p3', 'p2', 'p1']);
  assert.deepEqual(sortProjects(PROJECTS, 'name').map((p) => p.id), ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(
    sortProjects([{ name: 'b' }, { name: 'A' }], 'name').map((p) => p.name),
    ['A', 'b'],
    'name sorting is case-insensitive'
  );

  // Sorting must not mutate the caller's array.
  const original = [...PROJECTS];
  sortProjects(PROJECTS, 'name');
  assert.deepEqual(PROJECTS, original);
});

test('folder counts include All and Unfiled', () => {
  const counts = countProjectsPerFolder(PROJECTS, FOLDERS);
  assert.equal(counts[ALL_PROJECTS_ID], 4);
  assert.equal(counts.f1, 2);
  assert.equal(counts.f2, 1);
  assert.equal(counts[UNFILED_PROJECTS_ID], 1);
});

test('a project whose folder no longer exists counts as unfiled', () => {
  // deleteProjectFolder unfiles projects before removing the folder, so this
  // should not normally happen — but a dangling id must never make a project
  // invisible in every view at once.
  const dangling = [{ id: 'p9', name: 'orphan', folderId: 'gone' }];
  assert.equal(resolveProjectFolderId(dangling[0], new Set(['f1'])), null);

  const counts = countProjectsPerFolder(dangling, FOLDERS);
  assert.equal(counts[UNFILED_PROJECTS_ID], 1);
  const groups = buildProjectGroups(dangling, FOLDERS, {});
  assert.deepEqual(groups.map((g) => g.id), [UNFILED_PROJECTS_ID]);
  assert.deepEqual(groups[0].projects.map((p) => p.id), ['p9']);
});

test('the "all" view splits by folder, with Unfiled last', () => {
  const groups = buildProjectGroups(PROJECTS, FOLDERS, {});
  assert.deepEqual(groups.map((g) => g.id), ['f1', 'f2', UNFILED_PROJECTS_ID]);
  assert.deepEqual(groups.map((g) => g.name), ['Client Work', 'Tutorials', 'Unfiled']);
  assert.deepEqual(groups[0].projects.map((p) => p.id), ['p1', 'p4']);
  assert.equal(groups[2].isUnfiled, true);
  assert.equal(groups[0].isUnfiled, false);
});

test('empty folders are dropped from the full list but kept as an active filter', () => {
  const onlyUnfiled = [{ id: 'p3', name: 'promo-cut', folderId: null }];
  const all = buildProjectGroups(onlyUnfiled, FOLDERS, {});
  assert.deepEqual(all.map((g) => g.id), [UNFILED_PROJECTS_ID]);

  // Selecting an empty folder still produces a group, so the Hub can say
  // "nothing in here yet" with the folder's own name instead of rendering a
  // blank panel.
  const selected = buildProjectGroups(onlyUnfiled, FOLDERS, { folderId: 'f1' });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].name, 'Client Work');
  assert.deepEqual(selected[0].projects, []);
});

test('the unfiled filter shows only unfiled projects', () => {
  const groups = buildProjectGroups(PROJECTS, FOLDERS, { folderId: UNFILED_PROJECTS_ID });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].projects.map((p) => p.id), ['p3']);
});

test('the query applies inside the folder filter', () => {
  const groups = buildProjectGroups(PROJECTS, FOLDERS, { folderId: 'f1', query: 'intro' });
  assert.deepEqual(groups[0].projects.map((p) => p.id), ['p1']);

  const none = buildProjectGroups(PROJECTS, FOLDERS, { folderId: 'f1', query: 'lesson' });
  assert.deepEqual(none[0].projects, []);
});

test('an unknown active folder falls back to the full list', () => {
  // Deleting the folder you are looking at must not leave an empty panel with
  // no way back.
  const groups = buildProjectGroups(PROJECTS, FOLDERS, { folderId: 'deleted' });
  assert.deepEqual(groups.map((g) => g.id), ['f1', 'f2', UNFILED_PROJECTS_ID]);
});

test('grouping tolerates empty and missing inputs', () => {
  assert.deepEqual(buildProjectGroups([], []), []);
  assert.deepEqual(buildProjectGroups(undefined, undefined), []);
  assert.deepEqual(countProjectsPerFolder([], []), { [ALL_PROJECTS_ID]: 0, [UNFILED_PROJECTS_ID]: 0 });
  assert.deepEqual(buildProjectGroups(PROJECTS, FOLDERS, { folderId: ALL_PROJECTS_ID }).map((g) => g.id), [
    'f1',
    'f2',
    UNFILED_PROJECTS_ID,
  ]);
});
