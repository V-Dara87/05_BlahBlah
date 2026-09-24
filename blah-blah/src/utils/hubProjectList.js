/**
 * hubProjectList — how the Hub turns "every project folder the app knows about"
 * plus "the folders the user made" into the list on screen.
 *
 * Kept as pure functions, separate from HubScreen.jsx, for the same reason
 * timelineScene.js is separate from the Timeline: the interesting logic (which
 * projects match, which folder they land in, in what order) is then testable
 * without IndexedDB, a DOM or a directory handle. The component only renders
 * what this returns and calls the store for mutations.
 */

/** The 'filter by folder' values that are not a real folder id. */
export const ALL_PROJECTS_ID = 'all';
export const UNFILED_PROJECTS_ID = 'unfiled';

/** The sort options offered next to the search box. */
export const PROJECT_SORTS = Object.freeze([
  { id: 'recent', label: 'Recently opened' },
  { id: 'created', label: 'Recently created' },
  { id: 'name', label: 'Name (A–Z)' },
]);

export const DEFAULT_PROJECT_SORT = 'recent';

/** A stable, comparable lowercase string for a name/path. */
function normalize(value) {
  return String(value ?? '').toLowerCase();
}

/**
 * Does this project match the free-text query? Matches the name AND the path,
 * because the name alone is often generic ("my-video-project") while the path
 * is what the user remembers.
 */
export function matchesProjectQuery(project, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return true;
  return (
    normalize(project?.name).includes(needle) ||
    normalize(project?.path).includes(needle)
  );
}

/**
 * Which folder a project actually belongs to.
 *
 * A stored folderId that no longer resolves to a folder counts as Unfiled. That
 * cannot normally happen (deleteProjectFolder unfiles the projects first), but
 * it CAN happen if the folder store is cleared while the projects store is not
 * — and a project that belongs to a folder nobody can see would otherwise
 * disappear from the Hub entirely.
 */
export function resolveProjectFolderId(project, folderIds) {
  const folderId = project?.folderId ?? null;
  if (!folderId) return null;
  return folderIds.has(folderId) ? folderId : null;
}

/** Sort a copy of `projects` by one of PROJECT_SORTS (`recent` by default). */
export function sortProjects(projects, sort = DEFAULT_PROJECT_SORT) {
  const list = [...(projects || [])];
  if (sort === 'name') {
    return list.sort((a, b) => normalize(a?.name).localeCompare(normalize(b?.name)));
  }
  if (sort === 'created') {
    return list.sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0));
  }
  // 'recent' — the store's own order, but re-sorted so the grouping step below
  // can shuffle projects without depending on the incoming order.
  return list.sort((a, b) => (b?.lastOpenedAt || 0) - (a?.lastOpenedAt || 0));
}

/** How many projects sit in each folder (plus `unfiled`), for the filter chips. */
export function countProjectsPerFolder(projects, folders) {
  const folderIds = new Set((folders || []).map((folder) => folder.id));
  const counts = { [ALL_PROJECTS_ID]: 0, [UNFILED_PROJECTS_ID]: 0 };
  for (const folder of folders || []) counts[folder.id] = 0;

  for (const project of projects || []) {
    counts[ALL_PROJECTS_ID] += 1;
    const folderId = resolveProjectFolderId(project, folderIds);
    if (folderId) counts[folderId] += 1;
    else counts[UNFILED_PROJECTS_ID] += 1;
  }
  return counts;
}

/**
 * The list the Hub renders: `[{ id, name, isUnfiled, projects }]`.
 *
 * Three cases, mirroring the three kinds of folder filter:
 *
 *   - a specific folder selected -> exactly one group, for that folder, EVEN
 *     WHEN EMPTY. The Hub shows "no projects in here yet" with the folder's
 *     name, which is what makes an empty folder feel like an empty folder
 *     rather than a filter that broke.
 *   - 'unfiled' selected -> exactly one group, the projects with no folder.
 *   - 'all' (or nothing) selected -> every non-empty folder in creation order,
 *     with Unfiled last. Empty folders are dropped here on purpose: they are
 *     already visible as chips above the list, and a column of empty headings
 *     would push the real projects off screen.
 *
 * The query applies in every case, so searching is never scoped away by the
 * folder filter without the count in the header showing it.
 */
export function buildProjectGroups(projects, folders, options = {}) {
  const {
    query = '',
    sort = DEFAULT_PROJECT_SORT,
    folderId = ALL_PROJECTS_ID,
  } = options;

  const folderList = folders || [];
  const folderIds = new Set(folderList.map((folder) => folder.id));
  const matched = (projects || []).filter((project) => matchesProjectQuery(project, query));
  const sorted = sortProjects(matched, sort);

  if (folderId === UNFILED_PROJECTS_ID) {
    return [
      {
        id: UNFILED_PROJECTS_ID,
        name: 'Unfiled',
        isUnfiled: true,
        projects: sorted.filter((project) => !resolveProjectFolderId(project, folderIds)),
      },
    ];
  }

  if (folderId && folderId !== ALL_PROJECTS_ID) {
    const folder = folderList.find((f) => f.id === folderId);
    if (folder) {
      return [
        {
          id: folder.id,
          name: folder.name,
          isUnfiled: false,
          projects: sorted.filter((project) => resolveProjectFolderId(project, folderIds) === folder.id),
        },
      ];
    }
    // An unknown folder id (deleted while it was selected) falls through to the
    // full list rather than rendering nothing at all.
  }

  const groups = [];
  for (const folder of folderList) {
    const inFolder = sorted.filter((project) => resolveProjectFolderId(project, folderIds) === folder.id);
    if (inFolder.length > 0) {
      groups.push({ id: folder.id, name: folder.name, isUnfiled: false, projects: inFolder });
    }
  }

  const unfiled = sorted.filter((project) => !resolveProjectFolderId(project, folderIds));
  if (unfiled.length > 0) {
    groups.push({ id: UNFILED_PROJECTS_ID, name: 'Unfiled', isUnfiled: true, projects: unfiled });
  }
  return groups;
}
