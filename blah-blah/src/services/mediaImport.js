/**
 * Shared media import helper — converts picked/dropped File objects into
 * library assets.
 *
 * Both entry points funnel here so the picker ("Import Media" in the
 * Project panel) and OS file drops (Tauri window drag&drop, browser
 * drag&drop in dev) produce identical assets:
 *
 *   - Project panel's hidden <input type="file"> handler
 *   - the window-level drop handler in App.jsx (P2-1, OS file drops)
 *
 * In the browser this is the only way files enter the library. Under
 * Tauri the webview hands us sandboxed File objects (dragDropEnabled is
 * off so dockview's HTML5 DnD works), and useMediaAssets' persistence step
 * re-points each asset's URL at the on-disk copy streamed via
 * convertFileSrc once it lands in media/.
 *
 * Duration is probed by loading metadata from a temp <video>/<audio>
 * element (same technique the previous ProjectPanel-only code used); the
 * probing element is discarded afterwards. Unreadable media (or codecs
 * the webview can't parse) still import with the caller's fallback
 * duration instead of silently vanishing.
 */
const METADATA_TIMEOUT_MS = 6000;

function probeDuration(file, isVideo) {
  return new Promise((resolve) => {
    const el = document.createElement(isVideo ? 'video' : 'audio');
    el.crossOrigin = 'anonymous';
    const url = URL.createObjectURL(file);
    el.preload = 'metadata';
    el.src = url;

    let settled = false;
    const finish = (duration) => {
      if (settled) return;
      settled = true;
      el.removeAttribute('src');
      // Give the element a beat to release the blob before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve(duration);
    };

    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => finish(null);
    setTimeout(() => finish(null), METADATA_TIMEOUT_MS);
  });
}

/**
 * Import an array of File objects into the media library.
 *
 * @param {{ files: FileList|File[], onAddMediaAsset: Function }} args
 */
export async function importMediaFiles({ files, onAddMediaAsset }) {
  if (!files || !onAddMediaAsset) return;

  const accepted = Array.from(files).filter(
    (f) => f.type?.startsWith('video/') || f.type?.startsWith('audio/')
  );
  if (accepted.length === 0) return;

  await Promise.all(
    accepted.map(async (file) => {
      const isVideo = file.type.startsWith('video/');
      const duration = (await probeDuration(file, isVideo)) || (isVideo ? 8 : 10);
      onAddMediaAsset(
        {
          id: `asset-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          name: file.name,
          type: isVideo ? 'video' : 'audio',
          url: URL.createObjectURL(file),
          duration,
          size: file.size,
        },
        file
      );
    })
  );
}
