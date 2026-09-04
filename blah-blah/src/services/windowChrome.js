import { isTauri } from './tauriFsAdapter';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Frameless-window actions (P2-2). Desktop-only: the OS owns window chrome
 * in a plain browser, so every helper no-ops when !isTauri().
 */

let appWindow = null;

function getAppWindow() {
  if (!isTauri()) return null;
  if (!appWindow) {
    try {
      appWindow = getCurrentWindow();
    } catch (err) {
      console.warn('Failed to get current window handle:', err);
    }
  }
  return appWindow;
}

export function withCurrentWindow(action) {
  const win = getAppWindow();
  if (!win) return;
  try {
    const res = action(win);
    if (res && typeof res.catch === 'function') {
      res.catch((err) => {
        console.error('Window control action failed:', err);
      });
    }
  } catch (err) {
    console.error('Window control error:', err);
  }
}

/** Toggle maximize/restore — also bound to title-bar double-clicks. */
export function toggleWindowMaximize() {
  return withCurrentWindow(async (win) => {
    try {
      await win.toggleMaximize();
    } catch (err) {
      const isMax = await win.isMaximized();
      if (isMax) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    }
  });
}

