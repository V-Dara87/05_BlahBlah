import { isTauri } from './tauriFsAdapter';

/**
 * Frameless-window actions (P2-2). Desktop-only: the OS owns window chrome
 * in a plain browser, so every helper no-ops when !isTauri(). The window
 * API is imported dynamically so the browser bundle never touches the IPC
 * surface.
 */

let cachedWindow = null;

if (typeof window !== 'undefined' && isTauri()) {
  import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    cachedWindow = getCurrentWindow();
  }).catch(() => {});
}

export function withCurrentWindow(action) {
  if (!isTauri()) return;
  if (cachedWindow) {
    try {
      action(cachedWindow);
    } catch (err) {
      console.warn('Window control failed:', err);
    }
    return;
  }
  import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    cachedWindow = getCurrentWindow();
    action(cachedWindow);
  }).catch((err) => {
    console.warn('Window control failed:', err);
  });
}

/** Toggle maximize/restore — also bound to title-bar double-clicks. */
export function toggleWindowMaximize() {
  return withCurrentWindow((win) => win.toggleMaximize());
}
