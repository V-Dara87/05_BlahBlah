/**
 * Registry unifying the "one handler per item kind" branches that were
 * previously duplicated across ProjectPanel.jsx (sectionOrder / deleteItem /
 * moveItemToFolder / resolveSelectionEntries / commitRename — see the Step 1
 * audit). Adding a new kind means adding one entry here instead of touching
 * four-plus call sites.
 *
 * `ctx` is expected to be the subset of ProjectPanel's props that carry the
 * per-kind data arrays and handlers (mediaAssets, prefabs, scripts,
 * sharedItems, onRemoveMediaAsset, onMovePrefab, ...). Passing the whole
 * props object works fine.
 *
 * Deliberately NOT included here:
 *  - filteredMedia / filteredPrefabs / filteredScripts / filteredShared —
 *    these have kind-specific extra filters (mediaTypeFilter,
 *    scriptKindFilter) that don't fit a uniform getAllItems() shape without
 *    smuggling filter logic in here too. They stay as local variables in
 *    ProjectPanel.jsx.
 *  - the "share" action (prefab/script/media -> Shared Library; not offered
 *    for shared items) — not a 4-way branch, lives in ProjectPanel's
 *    shareToLibrary.
 *  - ctxMenu.target.kind values ('empty' | 'folder' | 'multi' | ...) — a
 *    different, unrelated use of the word "kind".
 */
 
export const KIND_REGISTRY = {
  media: {
    label: 'Media',
    getAllItems: (ctx) => ctx.mediaAssets,
    deleteFn: (id, ctx) => ctx.onRemoveMediaAsset?.(id),
    moveFn: (id, folderName, ctx) => ctx.onMoveMediaAsset?.(id, folderName),
    renameFn: (id, name, ctx) => { ctx.onRenameMediaAsset?.(id, name); },
  },
  prefab: {
    label: 'Prefab',
    getAllItems: (ctx) => ctx.prefabs,
    deleteFn: (id, ctx) => ctx.onRemovePrefab?.(id),
    moveFn: (id, folderName, ctx) => ctx.onMovePrefab?.(id, folderName),
    renameFn: (id, name, ctx) => { ctx.onRenamePrefab?.(id, name); },
  },
  script: {
    label: 'Script',
    getAllItems: (ctx) => ctx.scripts,
    deleteFn: (id, ctx) => ctx.onRemoveScript?.(id),
    moveFn: (id, folderName, ctx) => ctx.onMoveScript?.(id, folderName),
    // Script rename is async and can reject (see the try/catch around
    // onRenameScript in the original commitRename) — unlike media/prefab,
    // callers must await this and handle rejection themselves.
    renameFn: async (id, name, ctx) => { await ctx.onRenameScript?.(id, name); },
  },
  shared: {
    label: 'Shared Library',
    getAllItems: (ctx) => ctx.sharedItems,
    deleteFn: (id, ctx) => ctx.onRemoveSharedItem?.(id),
    moveFn: (id, folderName, ctx) => ctx.onMoveSharedItem?.(id, folderName),
    // Renaming shared items is not supported today (no onRenameSharedItem
    // prop exists). Left explicit as null rather than silently no-op'ing,
    // so callers can branch on it (see Step 4+ commitRename wiring).
    renameFn: null,
  },
};
 
export const KIND_ORDER = ['shared', 'prefab', 'media', 'script'];