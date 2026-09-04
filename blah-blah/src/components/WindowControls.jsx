import { Minus, Square, X } from 'lucide-react';
import { isTauri } from '../services/tauriFsAdapter';
import { withCurrentWindow, toggleWindowMaximize } from '../services/windowChrome';

/**
 * WindowControls — minimize / maximize / close buttons for the custom
 * (frameless) title bar.
 *
 * Renders nothing in a plain browser (`npm run dev`), where the OS owns
 * the window chrome. Under Tauri the buttons drive getCurrentWindow()'s
 * native methods via services/windowChrome.js (dynamic import, so the
 * browser bundle never touches the IPC surface). Attached to the far
 * right of the top bar — in the editor it lives at the right end of
 * MenuBar (via its `trailing` slot), and on the Hub screen in a slim
 * window bar.
 */
export function WindowControls() {
  if (!isTauri()) return null;

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control-btn"
        title="Minimize"
        onClick={() => withCurrentWindow((win) => win.minimize())}
      >
        <Minus size={12} />
      </button>
      <button
        type="button"
        className="window-control-btn"
        title="Maximize"
        onClick={() => toggleWindowMaximize()}
      >
        <Square size={10} />
      </button>
      <button
        type="button"
        className="window-control-btn window-control-close"
        title="Close"
        onClick={() => withCurrentWindow((win) => win.close())}
      >
        <X size={12} />
      </button>
    </div>
  );
}
