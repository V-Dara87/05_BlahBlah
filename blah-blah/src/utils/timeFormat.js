/**
 * Format seconds to SMPTE-like timecode (HH:MM:SS:FF or MM:SS.ms)
 * @param {number} seconds - Total time in seconds
 * @param {number} fps - Frames per second (default 30)
 * @returns {string} Formatted string like "00:01:23:15"
 */
export function formatTimecode(seconds = 0, fps = 30) {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  
  const totalFrames = Math.floor(seconds * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(seconds);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const pad = (n, len = 2) => String(n).padStart(len, '0');
  
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

/**
 * Format seconds to simple display time "01:23.4"
 */
export function formatSimpleTime(seconds = 0) {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(mins)}:${pad(secs)}.${ms}`;
}

/**
 * Format file size in bytes to human-readable string (MB, KB)
 */
export function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
