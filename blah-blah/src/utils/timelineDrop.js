import { importMediaFiles, detectMediaKind } from '../services/mediaImport';
import { readDragPayload } from './dragData';

/**
 * timelineDrop — the drop-payload handling shared by BOTH timeline renderers.
 *
 * The DOM path (TrackLane.jsx) and the canvas path (TimelineCanvas.jsx) each
 * own a different surface that receives the drop, but "what did the user drop
 * and where does it go" must stay identical between them, so the two branches
 * live here instead of being copy-pasted per renderer:
 *
 *   1. OS file drop (`dataTransfer.files`) — import the files into the media
 *      library, then place each imported asset on the target track at the
 *      drop time. Kept extension-aware via detectMediaKind rather than a
 *      MIME-only filter: some platforms (Tauri drag&drop especially) report an
 *      empty file.type for formats like .wav, which used to be silently
 *      dropped before importMediaFiles got a chance to run its own check.
 *   2. In-app drag (project-panel media/prefab/script, shared library) — the
 *      dragged card writes an `application/json` payload; hand it to
 *      onDropItemOnTrack with the track and time resolved from the drop point.
 *
 * @param {object}   params
 * @param {DragEvent} params.event
 * @param {number}   params.dropTime          seconds into the timeline
 * @param {string}   params.targetTrackId
 * @param {Array}    [params.mediaAssets]     for duplicate detection on import
 * @param {Function} [params.onAddMediaAsset] (asset, file) => void
 * @param {Function} [params.onDropItemOnTrack]
 * @returns {boolean} true when the drop was claimed/handled
 */
export function spawnDroppedItemOnTrack({
  event,
  dropTime = 0,
  targetTrackId,
  mediaAssets = [],
  onAddMediaAsset,
  onDropItemOnTrack,
}) {
  const dataTransfer = event?.dataTransfer;

  const files = dataTransfer?.files;
  if (files && files.length > 0 && onAddMediaAsset && onDropItemOnTrack) {
    const fileList = Array.from(files).filter((f) => detectMediaKind(f) !== null);
    if (fileList.length > 0) {
      importMediaFiles({
        files: fileList,
        mediaAssets,
        onAddMediaAsset: (asset, file) => {
          onAddMediaAsset(asset, file);
          onDropItemOnTrack({
            itemType: 'media',
            itemId: asset.id,
            itemData: asset,
            targetTrackId,
            startTime: dropTime,
          });
        },
      });
      return true;
    }
  }

  // In-app drag (Project panel media/prefab/script, shared library).
  const data = readDragPayload(dataTransfer);
  if (!data) return false;
  if (onDropItemOnTrack) {
    onDropItemOnTrack({
      itemType: data.itemType,
      itemId: data.itemData?.id,
      itemData: data.itemData,
      targetTrackId,
      startTime: dropTime,
    });
  }
  return true;
}
