import { isTauri } from '../services/tauriFsAdapter.js';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { popoutLabelForGroup } from './popoutGroup.js';

/**
 * Double-click a tab to maximize its group, and double-click again to restore —
 * the gesture people bring with them from Unity and VS Code, on top of the
 * group header's own maximize button.
 *
 * This is a delegated `dblclick` listener rather than a custom tab component:
 * dockview's stock tab already owns dragging, pinning and closing, and the only
 * thing being added is one more gesture on top of it. It has to be attached per
 * *document* — a popped-out group's tabs live in another window, and a
 * double-click there never reaches the main document's listeners.
 */

/**
 * Maximize (or restore) the group a tab belongs to.
 *
 * dockview tags every tab element with its panel id
 * (`data-tab-panel-id`), which is the only handle the delegated listener
 * needs.
 */
export function toggleMaximizeForTab(tabElement, api) {
  const panelId = tabElement?.dataset?.tabPanelId;
  const group = panelId ? api?.getPanel?.(panelId)?.group : null;
  if (!group?.api) return false;

  switch (group.api.location?.type) {
    case 'grid':
      if (group.api.isMaximized()) group.api.exitMaximized();
      else group.api.maximize();
      return true;
    case 'popout':
      // A popped-out group has no grid to maximize into, so the gesture means
      // what it means on any window title bar: maximize the window. `groupId`
      // is in the pop-out URL, so the window is reachable by label.
      void togglePopoutWindowMaximize(group.id);
      return true;
    default:
      // Floating groups have nothing to maximize into either (and dockview
      // ignores the call), so leave the gesture inert rather than half-working.
      return false;
  }
}

/**
 * Maximize / restore the OS window a popped-out group lives in. Uses Tauri's
 * `toggleMaximize` (already permitted by the app's capabilities) so the state
 * never has to be read first.
 */
export async function togglePopoutWindowMaximize(groupId) {
  const label = popoutLabelForGroup(groupId);
  if (!label || !isTauri()) return false;
  try {
    const popoutWindow = await WebviewWindow.getByLabel(label);
    if (!popoutWindow) return false;
    await popoutWindow.toggleMaximize();
    return true;
  } catch (err) {
    console.warn(`dockview: could not maximize pop-out window ${label}:`, err);
    return false;
  }
}

/**
 * Listen for tab double-clicks inside `root` (an element or a `Window`).
 * Returns a detach function.
 */
export function attachTabDoubleClickMaximize(root, api) {
  if (!root?.addEventListener || !api) return () => {};

  const handleDoubleClick = (event) => {
    // Cross-realm safe: an element inside a pop-out window is not an instance
    // of the main window's `Element`, so duck-type instead of using `instanceof`.
    const target = event.target;
    if (!target?.closest) return;
    // The tab's close button sits inside the tab; double-clicking it is a
    // close, not a maximize.
    if (target.closest('.dv-default-tab-action')) return;
    const tab = target.closest('.dv-tab');
    if (tab) toggleMaximizeForTab(tab, api);
  };

  root.addEventListener('dblclick', handleDoubleClick);
  return () => root.removeEventListener('dblclick', handleDoubleClick);
}
