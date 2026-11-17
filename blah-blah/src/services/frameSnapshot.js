import { renderEditorFrame } from './aiBridgeService';
import { isTauri } from './tauriFsAdapter';
import { showNotice } from '../utils/notice';

/**
 * Captures the actual composited screen frame at the current playhead time
 * and saves it as a PNG image file.
 */
export async function captureAndExportScreenPng({
  time = 0,
  entities = [],
  tracks = [],
  scripts = [],
  resolution = { width: 1920, height: 1080 },
  mediaAssets = [],
  projectName = 'snapshot',
}) {
  try {
    showNotice('Capturing full-resolution frame...');
    const result = await renderEditorFrame({
      time,
      entities,
      tracks,
      scripts,
      resolution,
      mediaAssets,
      maxLongSide: 0, // Full resolution (unscaled)
    });

    if (!result || !result.pngBase64) {
      throw new Error('Frame capture returned empty image data.');
    }

    const { width, height, pngBase64 } = result;
    const timeFormatted = time.toFixed(2).replace('.', '_');
    const safeProject = String(projectName || 'frame').replace(/[^a-zA-Z0-9_-]/g, '_');
    const defaultFilename = `${safeProject}_${timeFormatted}s_${width}x${height}.png`;

    // 1. In Tauri environment, attempt to use native save dialog
    if (isTauri()) {
      try {
        const dialog = await import('@tauri-apps/plugin-dialog');
        const fs = await import('@tauri-apps/plugin-fs');
        const savePath = await dialog.save({
          defaultPath: defaultFilename,
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        });

        if (savePath) {
          const binary = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
          await fs.writeFile(savePath, binary);
          showNotice(`✓ Frame saved to ${savePath} (${width}x${height})`);
          return { success: true, path: savePath, width, height };
        }
        return { success: false, cancelled: true };
      } catch (tauriErr) {
        console.warn('Native dialog failed, falling back to browser download:', tauriErr);
      }
    }

    // 2. Browser fallback: trigger automatic download via anchor element
    const binary = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([binary], { type: 'image/png' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = defaultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showNotice(`✓ Frame downloaded: ${defaultFilename} (${width}x${height})`);
    return { success: true, filename: defaultFilename, width, height };
  } catch (err) {
    console.error('Failed to export screen PNG:', err);
    showNotice(`✗ Frame export failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}
