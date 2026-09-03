import { useState } from 'react';
import { saveMediaFileToFolder } from '../services/projectFileSystem';

/**
 * useMediaAssets — the media-asset library (state + import/remove logic).
 *
 * Owns `mediaAssets` and the two handlers that mutate it:
 *   - handleAddMediaAsset: prepends an asset (and, when imported via the
 *     file picker with `originalFile`, persists it into the project's
 *     media/ folder on disk)
 *   - handleRemoveMediaAsset: drops an asset from the library
 *
 * Extracted out of App.jsx during the shell split. Deliberately separate
 * from useProjectStore (entities/tracks/scripts/prefabs): mediaAssets is
 * OUT of the undo scope by design (asset imports are non-undoable
 * housekeeping, matching how most editors treat media), so it doesn't live
 * in the same useUndoableState history stack and doesn't belong in the
 * store that owns undo.
 *
 * No logic changes from App.jsx — `projectFolderHandle` is injected as a
 * hook param (the shell owns that state) purely so handleAddMediaAsset can
 * still persist imported files next to the project. The full `setMediaAssets`
 * is returned because the project-swap load paths (in useProjectStore) and
 * the Project-JSON apply replace the whole list at once.
 */
export function useMediaAssets({ projectFolderHandle } = {}) {
  const [mediaAssets, setMediaAssets] = useState([]);

  // Upload Media File
  const handleAddMediaAsset = async (asset, originalFile = null) => {
    setMediaAssets(prev => [asset, ...prev]);
    if (projectFolderHandle && originalFile) {
      await saveMediaFileToFolder(projectFolderHandle, originalFile, asset.folder || null).catch(() => {});
    }
  };

  const handleRemoveMediaAsset = (assetId) => {
    setMediaAssets(prev => prev.filter(a => a.id !== assetId));
  };

  return {
    mediaAssets,
    setMediaAssets,
    handleAddMediaAsset,
    handleRemoveMediaAsset,
  };
}
