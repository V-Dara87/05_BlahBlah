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
 * duration instead of silently vanishing. The URL-based probe
 * (probeMediaElementDuration) is exported so the project RELOAD path
 * (services/projectFileSystem.js, which rebuilds mediaAssets by scanning
 * media/ on disk) can re-derive each file's real duration the same way
 * instead of stamping a placeholder.
 */
const METADATA_TIMEOUT_MS = 6000;

// Fallback durations used when metadata probing genuinely fails (corrupt
// file, unsupported codec, timeout) — kept in one place so the import and
// reload paths can't drift. Probing succeeds for normal files, so these
// only surface for broken media.
export const MEDIA_FALLBACK_DURATION = { video: 8, audio: 10 };

/**
 * Probe media duration from a playable URL — blob:, http(s), or a Tauri
 * convertFileSrc asset URL — by loading metadata into a throwaway
 * <video>/<audio> element. Resolves the real duration in seconds, or null
 * when the file can't be parsed or metadata never arrives within
 * `timeoutMs`. Never throws.
 *
 * The caller owns the URL's lifetime: this helper does NOT revoke it, so
 * callers that keep the URL alive for playback (assets in the media
 * library) can probe without worrying about a race. File-based callers
 * (probeFileDuration) build a throwaway object URL and revoke it
 * themselves.
 */
export function probeMediaElementDuration(url, isVideo, timeoutMs = METADATA_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const el = document.createElement(isVideo ? 'video' : 'audio');
    el.crossOrigin = 'anonymous';
    el.preload = 'metadata';
    el.src = url;

    let settled = false;
    const finish = (duration) => {
      if (settled) return;
      settled = true;
      el.removeAttribute('src');
      resolve(Number.isFinite(duration) ? duration : null);
    };

    el.onloadedmetadata = () => finish(el.duration);
    el.onerror = () => finish(null);
    setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * Duration probe for a File object: wraps the shared URL probe over a
 * temporary object URL, revoking it once the probe settles (the element
 * gets a beat to release the blob before the URL is revoked).
 *
 * Exported so non-import flows that already hold a File can re-derive a
 * real duration with the exact same technique (e.g. asset replace).
 */
export async function probeFileDuration(file, isVideo) {
  const url = URL.createObjectURL(file);
  const duration = await probeMediaElementDuration(url, isVideo);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return duration;
}

/**
 * Import an array of File objects into the media library.
 *
 * Duplicate detection: before creating an asset, an existing entry with
 * the SAME name AND same size is treated as a likely re-import of the same
 * file. Duplicates are NOT skipped — the import proceeds normally (no data
 * loss) — but the count is reported via `onDuplicatesDetected` after the
 * parallel import finishes, so the caller can surface a lightweight
 * warning without blocking the import pipeline.
 *
 * @param {{ files: FileList|File[], onAddMediaAsset: Function, mediaAssets?: Array, onDuplicatesDetected?: (count: number) => void }} args
 */
export async function importMediaFiles({ files, onAddMediaAsset, mediaAssets = [], onDuplicatesDetected }) {
  if (!files || !onAddMediaAsset) return;

  const accepted = Array.from(files).filter(
    (f) => f.type?.startsWith('video/') || f.type?.startsWith('audio/')
  );
  if (accepted.length === 0) return;

  let duplicateCount = 0;
  await Promise.all(
    accepted.map(async (file) => {
      const isVideo = file.type.startsWith('video/');
      // Both name AND size must match — name alone is too loose (different
      // files can share a name), size alone too loose for small files.
      const looksDuplicate = (mediaAssets || []).some(
        (a) => a.name === file.name && a.size === file.size
      );
      if (looksDuplicate) duplicateCount++;

      const duration = (await probeFileDuration(file, isVideo)) || MEDIA_FALLBACK_DURATION[isVideo ? 'video' : 'audio'];
      onAddMediaAsset(
        {
          id: `asset-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          name: file.name,
          type: isVideo ? 'video' : 'audio',
          url: URL.createObjectURL(file),
          duration,
          size: file.size,
          createdAt: Date.now(),
        },
        file
      );
    })
  );

  if (duplicateCount > 0 && typeof onDuplicatesDetected === 'function') {
    onDuplicatesDetected(duplicateCount);
  }
}
