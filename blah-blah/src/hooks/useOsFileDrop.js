import { useEffect } from 'react';
import { importMediaFiles } from '../services/mediaImport';
 
/**
 * useOsFileDrop — OS file drag-and-drop coexistence (P2-1).
 *
 * The window runs with dragDropEnabled: false because dockview's HTML5
 * DnD (tab/panel movement) is what actually works in the webview then —
 * that same flag disables Tauri's onDragDropEvent, so OS file drops
 * arrive the same way they do in a browser: as DOM drag events carrying
 * sandboxed File objects. This window-level handler catches exactly
 * those (a real drop always has dataTransfer.files) and imports any
 * video/audio into the media library via the shared importMediaFiles
 * helper. In-app drags (timeline clips, project-panel cards) carry
 * custom JSON with NO files and pass straight through untouched.
 *
 * Entirely self-contained: attaches/detaches its own document-level
 * listeners and touches nothing else in App.jsx's render, so it's a
 * fire-and-forget hook — App.jsx doesn't need anything back from it.
 * Needs `mediaAssets` (for duplicate-detection) and `handleAddMediaAsset`
 * (from useMediaAssets) as inputs since this is App-level import policy,
 * not something useMediaAssets itself knows about.
 */
export function useOsFileDrop({ mediaAssets, handleAddMediaAsset }) {
  useEffect(() => {
    const isFileDrop = (e) => (e.dataTransfer?.files?.length ?? 0) > 0;
 
    const onDragOver = (e) => {
      if (isFileDrop(e)) e.preventDefault();
    };
    const onDrop = (e) => {
      if (!isFileDrop(e)) return;
      // Dropping onto a timeline lane is handled by the canvas timeline itself
      // (import + place at the drop position), and that handler stops
      // propagation, so a file dropped on a lane never reaches this listener.
      e.preventDefault();
 
      // Check if dropped into a specific folder or into ProjectPanel with a folder open
      let targetFolder = null;
      const folderEl = e.target?.closest?.('[data-project-folder]');
      if (folderEl) {
        const sec = folderEl.getAttribute('data-project-section');
        if (!sec || sec === 'media') {
          targetFolder = folderEl.getAttribute('data-project-folder') || null;
        }
      } else {
        const panelEl = e.target?.closest?.('[data-project-current-folder]');
        if (panelEl) {
          const sec = panelEl.getAttribute('data-project-current-section');
          if (!sec || sec === 'media') {
            targetFolder = panelEl.getAttribute('data-project-current-folder') || null;
          }
        }
      }
 
      importMediaFiles({
        files: e.dataTransfer.files,
        onAddMediaAsset: (asset, file) => {
          if (targetFolder) {
            asset.folder = targetFolder;
          }
          handleAddMediaAsset(asset, file);
        },
        mediaAssets,
        // OS file drops happen outside the Project panel, so a lightweight
        // alert is the only surface available here (the panel shows an
        // inline notice for picker imports).
        onDuplicatesDetected: (count) => {
          alert(`${count} file(s) look like duplicates of existing media assets.`);
        },
      });
    };
 
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [handleAddMediaAsset, mediaAssets]);
}