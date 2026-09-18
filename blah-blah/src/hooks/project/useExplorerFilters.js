import { useState, useCallback, useMemo } from 'react';
import { detectScriptKind } from '../../engine/scriptRunner';

/**
 * Owns search/sort/type-filter state and derives the filtered, sorted item
 * lists for each section plus "what's visible in the current folder".
 *
 * @param {object} params
 * @param {any[]} params.mediaAssets
 * @param {any[]} params.prefabs
 * @param {any[]} params.scripts
 * @param {any[]} params.sharedItems
 * @param {{section:string|null, folder:string|null}} params.currentLocation
 * @param {Record<string,string[]>} params.foldersBySection
 */
export function useExplorerFilters({
  mediaAssets,
  prefabs,
  scripts,
  sharedItems,
  currentLocation,
  foldersBySection,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('name-asc');
  const [mediaTypeFilter, setMediaTypeFilter] = useState({ video: true, audio: true });
  const [scriptKindFilter, setScriptKindFilter] = useState({ react: true, canvas: true, motion: true });

  const sortList = useCallback(
    (list) => {
      const sorted = [...list];
      switch (sortBy) {
        case 'name-asc':
          sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          break;
        case 'name-desc':
          sorted.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
          break;
        case 'date-asc':
          sorted.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          break;
        case 'date-desc':
          sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          break;
        case 'duration-desc':
          sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0));
          break;
        case 'duration-asc':
          sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0));
          break;
        case 'size-desc':
          sorted.sort((a, b) => (b.size || 0) - (a.size || 0));
          break;
        case 'size-asc':
          sorted.sort((a, b) => (a.size || 0) - (b.size || 0));
          break;
        default:
          break;
      }
      return sorted;
    },
    [sortBy]
  );

  const handleSortByColumn = useCallback((col) => {
    setSortBy((prev) => {
      if (prev === `${col}-asc`) return `${col}-desc`;
      return `${col}-asc`;
    });
  }, []);

  const query = searchQuery.toLowerCase().trim();

  // Filtered lists per section
  const filteredShared = useMemo(
    () => sortList(sharedItems.filter((i) => (i.name || '').toLowerCase().includes(query))),
    [sharedItems, query, sortList]
  );

  const filteredPrefabs = useMemo(
    () => sortList(prefabs.filter((p) => (p.name || '').toLowerCase().includes(query))),
    [prefabs, query, sortList]
  );

  const filteredMedia = useMemo(
    () =>
      sortList(
        mediaAssets.filter(
          (m) =>
            (m.name || '').toLowerCase().includes(query) &&
            ((mediaTypeFilter.video && m.type === 'video') ||
              (mediaTypeFilter.audio && m.type === 'audio'))
        )
      ),
    [mediaAssets, query, mediaTypeFilter, sortList]
  );

  const filteredScripts = useMemo(
    () =>
      sortList(
        scripts.filter((s) => {
          if (!(s.name || '').toLowerCase().includes(query)) return false;
          const kind = detectScriptKind(s.code || '');
          return scriptKindFilter[kind] !== false;
        })
      ),
    [scripts, query, scriptKindFilter, sortList]
  );

  // Active items for the CURRENT navigated location
  const currentSectionItems = useMemo(() => {
    if (!currentLocation.section) return [];
    if (currentLocation.section === 'media') return filteredMedia;
    if (currentLocation.section === 'prefabs') return filteredPrefabs;
    if (currentLocation.section === 'scripts') return filteredScripts;
    if (currentLocation.section === 'shared') return filteredShared;
    return [];
  }, [currentLocation.section, filteredMedia, filteredPrefabs, filteredScripts, filteredShared]);

  const filteredItemsInView = useMemo(() => {
    if (!currentLocation.section) return [];
    if (searchQuery) {
      // While searching, show all matching items in this section regardless of folder
      return currentSectionItems;
    }
    if (currentLocation.folder) {
      return currentSectionItems.filter((i) => i.folder === currentLocation.folder);
    }
    // At section root: show items with no folder
    return currentSectionItems.filter((i) => !i.folder);
  }, [currentLocation, currentSectionItems, searchQuery]);

  const subfolderNamesInView = useMemo(() => {
    if (!currentLocation.section || currentLocation.folder || searchQuery) return [];
    const all = foldersBySection[currentLocation.section] || [];
    return all;
  }, [currentLocation, foldersBySection, searchQuery]);

  return {
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    mediaTypeFilter,
    setMediaTypeFilter,
    scriptKindFilter,
    setScriptKindFilter,
    sortList,
    handleSortByColumn,
    filteredShared,
    filteredPrefabs,
    filteredMedia,
    filteredScripts,
    currentSectionItems,
    filteredItemsInView,
    subfolderNamesInView,
  };
}