import { useState } from 'react';
import { saveMediaFileToFolder } from '../services/projectFileSystem';
import { probeFileDuration, MEDIA_FALLBACK_DURATION } from '../services/mediaImport';

/**
 * useMediaAssets — the media-asset library (state + import/remove logic).
 *
 * Owns `mediaAssets` and the handlers that mutate it:
 *   - handleAddMediaAsset: prepends an asset (and, when imported via the
 *     file picker with `originalFile`, persists it into the project's
 *     media/ folder on disk)
 *   - handleRemoveMediaAsset: drops an asset from the library
 *   - handleMoveMediaAsset: reassigns an asset's folder (folder tree drag)
 *   - handleReplaceMediaAsset: swaps the underlying file of an asset
 *     WITHOUT changing its id (so timeline references keep working); only
 *     url/size/duration/type update, and the on-disk copy in media/ is
 *     overwritten in place when a project folder is attached
 *
 * Extracted out of App.jsx during the shell split. Deliberately separate
 * from useProjectStore (entities/tracks/scripts/prefabs): mediaAssets is
 * OUT of the undo scope by design (asset imports are non-undoable
 * housekeeping, matching how most editors treat media), so it doesn't live
 * in the same useUndoableState history stack and doesn't belong in the
 * store that owns undo.
 *
 * `projectFolderHandle` is injected as a hook param (the shell owns that
 * state) purely so handleAddMediaAsset can still persist imported files
 * next to the project. The full `setMediaAssets` is returned because the
 * project-swap load paths (in useProjectStore) and the Project-JSON apply
 * replace the whole list at once.
 *
 * Tauri note: after persisting an imported file into media/, the asset's
 * URL is re-pointed at the on-disk copy via convertFileSrc (HTTP Range
 * streaming instead of holding the whole file in memory as a blob), and
 * the temporary blob URL used to probe it is revoked. saveMediaFileToFolder
 * returns the saved absolute path so this works even when the imported
 * file was never readable as a blob.
 */
export function useMediaAssets({ projectFolderHandle } = {}) {
  const [mediaAssets, setMediaAssets] = useState([]);

  // Upload Media File
  const handleAddMediaAsset = async (asset, originalFile = null) => {
    setMediaAssets(prev => [asset, ...prev]);
    if (projectFolderHandle && originalFile) {
      const savedPath = await saveMediaFileToFolder(projectFolderHandle, originalFile, asset.folder || null).catch(() => null);
      // Tauri: swap the in-memory blob for a streamed URL of the copy now
      // sitting in media/, and free the blob (it was only for probing).
      if (savedPath) {
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        setMediaAssets(prev => prev.map(a => a.id === asset.id
          ? { ...a, url: convertFileSrc(savedPath), path: savedPath }
          : a
        ));
      }
    }
  };

  const handleRemoveMediaAsset = (assetId) => {
    setMediaAssets(prev => prev.filter(a => a.id !== assetId));
  };

  // Reassign an asset's folder (null = root media folder). Used by the
  // Project panel folder drag-and-drop.
  const handleMoveMediaAsset = (assetId, targetFolderName) => {
    setMediaAssets(prev => prev.map(a => a.id === assetId ? { ...a, folder: targetFolderName || null } : a));
  };

  // Replace the underlying file of an existing asset. The id is preserved
  // (the whole codebase locates assets by id, so anything referencing this
  // asset keeps working without re-linking); only url/size/duration/type
  // change. Cross-type replace (video → audio) is allowed and flagged — it
  // may desync consumers that assumed a stable type.
  const handleReplaceMediaAsset = async (assetId, newFile) => {
    const asset = mediaAssets.find(a => a.id === assetId);
    if (!asset || !newFile) return;
    const isVideo = newFile.type.startsWith('video/');
    const duration = (await probeFileDuration(newFile, isVideo)) || MEDIA_FALLBACK_DURATION[isVideo ? 'video' : 'audio'];

    setMediaAssets(prev => prev.map(a => a.id === assetId ? {
      ...a,
      url: URL.createObjectURL(newFile),
      size: newFile.size,
      duration,
      type: isVideo ? 'video' : 'audio',
    } : a));

    // Persist the replacement over the SAME on-disk location (keep the
    // asset's existing filename) so paths already referencing it stay
    // valid — saveMediaFileToFolder takes an explicit target name.
    if (projectFolderHandle) {
      const savedPath = await saveMediaFileToFolder(projectFolderHandle, newFile, asset.folder || null, asset.name).catch(() => null);
      if (savedPath) {
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        setMediaAssets(prev => prev.map(a => a.id === assetId
          ? { ...a, url: convertFileSrc(savedPath), path: savedPath }
          : a
        ));
      }
    }
  };

  return {
    mediaAssets,
    setMediaAssets,
    handleAddMediaAsset,
    handleRemoveMediaAsset,
    handleMoveMediaAsset,
    handleReplaceMediaAsset,
  };
}
