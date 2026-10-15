/**
 * exportFileStream — write the muxer's output straight to disk, as it is
 * produced, instead of buffering the whole file in memory.
 *
 * WHY. `mp4-muxer`'s ArrayBufferTarget appends every encoded video and audio
 * chunk to one growing in-memory buffer, and the export then built a SECOND
 * full copy on top of it (`new Blob([buffer])` / `new Uint8Array(buffer)` for
 * `writeFile`). A one-hour 1080p H.264 export at 8 Mbps is ~3.6 GB of encoded
 * video alone, so that path needed roughly 7 GB+ of live memory before a byte
 * reached disk. Backing the muxer with a `StreamTarget` whose `onData` writes
 * to an open file handle removes both copies: each finalized chunk is written
 * where the muxer says it goes and then dropped.
 *
 * ORDERING. mp4-muxer's StreamTarget contract is `onData(data, position)`
 * where `position` is the ABSOLUTE byte offset the data belongs at — the
 * library explicitly warns that ignoring `position` produces broken output.
 * Chunks arrive in order in every mode this app uses, but seeking to
 * `position` before each write makes the writer correct even if that ever
 * changes, and costs one cheap syscall per chunk. Writes are serialized
 * through a promise chain, since `onData` is synchronous and `FileHandle.write`
 * is not — otherwise two chunks could interleave and corrupt the file.
 *
 * Tauri only. Outside Tauri there is no writable file handle from a save path
 * (the browser gets an object URL download instead), so callers keep the
 * in-memory path there — see ExportModal.jsx.
 */
import { joinPath, removeFileIfExists } from './tauriFsAdapter.js';
 
/**
 * Open `filePath` for streamed writing and return an mp4-muxer-compatible
 * `onData` sink plus a `close`/`abort` pair.
 *
 * @param {string} filePath absolute destination path
 * @returns {Promise<{
 *   filePath: string,
 *   onData: (data: Uint8Array, position: number) => void,
 *   close: () => Promise<number>,
 *   abort: () => Promise<void>,
 *   bytesWritten: () => number,
 * }>}
 */
export async function openExportFileStream(filePath) {
  if (!filePath) throw new Error('openExportFileStream requires a destination path.');
 
  const fs = await import('@tauri-apps/plugin-fs');
  // NOT `append: true`: appending would ignore the muxer's positions. `truncate`
  // makes a re-export over an existing file deterministic.
  const handle = await fs.open(filePath, { write: true, create: true, truncate: true });
 
  /** Serializes writes; a rejection here poisons the chain so later writes are skipped. */
  let chain = Promise.resolve();
  let written = 0;
 
  const enqueue = (operation) => {
    const next = chain.then(operation);
    // Keep the chain rejecting for close() while making sure the rejection is
    // always "handled" (no unhandled-rejection noise if the caller only calls
    // close() after the export already failed for another reason).
    next.catch(() => {});
    chain = next;
    return next;
  };
 
  return {
    filePath,
 
    onData: (data, position) => {
      // `data` is a subarray of a chunk buffer the muxer has already dropped
      // references to, so it is safe to hold across the await without copying.
      enqueue(async () => {
        // Tauri's FileHandle.seek(offset, whence) REQUIRES `whence` — without it
        // the call fails with "missing required key whence" and the whole
        // export aborts. Start = `position` is an absolute offset in the file.
        await handle.seek(position, fs.SeekMode.Start);
        await handle.write(data);
        written += data.byteLength;
      });
    },
 
    /** Flush every pending write, close the file and report the byte count. */
    async close() {
      await chain;
      await handle.close();
      return written;
    },
 
    /** Stop early (abort/error): flush what we can, close, and delete the partial file. */
    async abort() {
      try {
        await chain;
      } catch {
        // A failed write is the usual reason we are here; nothing more to flush.
      }
      try {
        await handle.close();
      } catch {
        // already closed
      }
      await removeFileIfExists(filePath);
    },
 
    bytesWritten: () => written,
  };
}
 
/**
 * Default name for a temp PCM file used by the windowed audio decode
 * (exportRunner.js decodeAudioWindow) — kept here so both the encoder-side
 * and decode-side temp files follow one naming convention.
 */
export function exportTempFileName(prefix, sourcePath) {
  const base = String(sourcePath || 'source').split(/[/\\]/).pop() || 'source';
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  return `${prefix}-${safe}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.raw`;
}
 
/** Join a directory with a generated temp file name (see exportTempFileName). */
export function exportTempPath(dirPath, prefix, sourcePath) {
  return joinPath(dirPath, exportTempFileName(prefix, sourcePath));
}