import { useState, useEffect, useRef } from 'react';
import {
  saveMediaFileToFolder,
  deleteMediaFileFromFolder,
  moveMediaFileOnDisk,
} from '../services/projectFileSystem';
import { probeFileDuration, MEDIA_FALLBACK_DURATION, detectMediaKind } from '../services/mediaImport';
import { isTauri } from '../services/tauriFsAdapter';
import {
  setPeakProjectDirectory,
  setMediaAssetsSource,
  ensurePeaksForAssets,
  enqueuePeakGeneration,
  resetPeakStatusForAsset,
  deletePeaksForAsset,
} from '../services/peakCache';
 
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
export function useMediaAssets({ projectFolderHandle, onReconcileAssetUrl } = {}) {
  const [mediaAssets, setMediaAssets] = useState([]);

  // The peak cache resolves assets out of the live library (by id and by
  // url) and needs to know which project's `.cache/peaks` it is reading and
  // writing. Keep both in sync here rather than threading handles through
  // every caller.
  const mediaAssetsRef = useRef(mediaAssets);

  useEffect(() => {
    mediaAssetsRef.current = mediaAssets;
  }, [mediaAssets]);

  useEffect(() => {
    setMediaAssetsSource(() => mediaAssetsRef.current);
  }, []);

  useEffect(() => {
    setPeakProjectDirectory(projectFolderHandle);
  }, [projectFolderHandle]);

  // Fill in missing peak files in the background whenever the library or the
  // open project changes. enqueuePeakGeneration is idempotent and a no-op
  // outside Tauri, and this only ever produces status + files — the timeline
  // keeps drawing through the old path until peaks are actually ready.
  useEffect(() => {
    ensurePeaksForAssets(mediaAssets);
  }, [mediaAssets, projectFolderHandle]);
 
  // Upload Media File
  // Returns the FINAL resolved URL for the saved asset — the disk URL if
  // a save happened, otherwise the original asset.url unchanged. Callers
  // that create a timeline clip right after adding an asset (e.g. voice
  // recording's stop handler) MUST use this return value for the clip's
  // src, not the asset object they originally passed in — see the long
  // comment below for why using the stale object silently breaks
  // playback after a reload.
  const handleAddMediaAsset = async (asset, originalFile = null) => {
    setMediaAssets(prev => [asset, ...prev]);
    if (projectFolderHandle && originalFile) {
      const savedPath = await saveMediaFileToFolder(projectFolderHandle, originalFile, asset.folder || null).catch(() => null);
      // Tauri: swap the in-memory blob for a streamed URL of the copy now
      // sitting in media/, and free the blob (it was only for probing).
      if (savedPath) {
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        const diskUrl = convertFileSrc(savedPath);
        const diskAsset = { ...asset, url: diskUrl, path: savedPath };
        setMediaAssets(prev => prev.map(a => a.id === asset.id ? diskAsset : a));
        // Now that the file is on disk with a real path, background peak
        // generation can actually run for it.
        enqueuePeakGeneration(diskAsset);
        // Backstop for any OTHER caller that doesn't use this function's
        // return value (see the doc comment above) — re-points any
        // entity/component that somehow still references the stale blob
        // URL. The PRIMARY fix is the return value below: the voice
        // recording handler now awaits this call and builds the timeline
        // clip from the returned URL directly, so the clip never points
        // at the stale blob URL in the first place. This used to be the
        // only fix attempted, but it ran too late — by the time it fired,
        // handleAddMediaToTimeline had already created the clip from the
        // ORIGINAL asset object (a separate in-memory copy whose .url
        // was never mutated), so there was nothing yet to reconcile. This
        // is the actual reason recorded clips — trimmed or not — lost
        // their audio after a reload: not that reconciliation was
        // missing, but that it ran after the clip it needed to fix
        // already existed with the wrong URL baked in.
        if (onReconcileAssetUrl) {
          onReconcileAssetUrl(asset.url, diskUrl);
        }
        return diskUrl;
      }
    }
    return asset.url;
  };
 
  const handleRemoveMediaAsset = async (assetId) => {
    const asset = mediaAssets.find((a) => a.id === assetId);
    setMediaAssets((prev) => prev.filter((a) => a.id !== assetId));
    if (projectFolderHandle && asset) {
      // Delete the generated peak file first, while the media file is still
      // on disk for the size/mtime-based name to resolve.
      await deletePeaksForAsset(asset);
      await deleteMediaFileFromFolder(
        projectFolderHandle,
        asset.name,
        asset.folder || null,
        asset.path || null
      ).catch((err) => {
        console.warn('Could not delete media file from disk:', err);
      });
    }
  };
 
  // Reassign an asset's folder (null = root media folder). Used by the
  // Project panel folder drag-and-drop.
  const handleMoveMediaAsset = async (assetId, targetFolderName) => {
    const asset = mediaAssets.find((a) => a.id === assetId);
    setMediaAssets((prev) =>
      prev.map((a) => (a.id === assetId ? { ...a, folder: targetFolderName || null } : a))
    );
    if (projectFolderHandle && asset) {
      const newPath = await moveMediaFileOnDisk(
        projectFolderHandle,
        asset.name,
        asset.folder || null,
        targetFolderName || null,
        asset.path || null
      ).catch(() => null);
      if (newPath) {
        let newUrl = null;
        if (isTauri()) {
          const { convertFileSrc } = await import('@tauri-apps/api/core');
          newUrl = convertFileSrc(newPath);
        }
        setMediaAssets((prev) =>
          prev.map((a) =>
            a.id === assetId
              ? { ...a, path: newPath, ...(newUrl ? { url: newUrl } : {}) }
              : a
          )
        );
        if (newUrl && onReconcileAssetUrl && asset.url) {
          onReconcileAssetUrl(asset.url, newUrl);
        }
      }
    }
  };
 
  // Replace the underlying file of an existing asset. The id is preserved
  // (the whole codebase locates assets by id, so anything referencing this
  // asset keeps working without re-linking); only url/size/duration/type
  // change. Cross-type replace (video → audio) is allowed and flagged — it
  // may desync consumers that assumed a stable type.
  const handleReplaceMediaAsset = async (assetId, newFile) => {
    const asset = mediaAssets.find(a => a.id === assetId);
    if (!asset || !newFile) return;
    // FIXED — same MIME-only detection bug as mediaImport.js: relying
    // solely on newFile.type mis-detects (or, in importMediaFiles' case,
    // outright rejects) files like .wav when the platform doesn't report
    // a MIME type. detectMediaKind falls back to the extension.
    const isVideo = detectMediaKind(newFile) === 'video';
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
        const replaced = { ...asset, url: convertFileSrc(savedPath), path: savedPath };
        setMediaAssets(prev => prev.map(a => a.id === assetId ? replaced : a));
        // The bytes changed, so the asset's old peak file no longer applies;
        // forget its status and queue a fresh generation for the new file.
        resetPeakStatusForAsset(assetId);
        enqueuePeakGeneration(replaced);
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