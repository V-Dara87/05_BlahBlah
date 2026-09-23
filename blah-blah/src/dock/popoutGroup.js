import { isTauri } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

/**
 * Panel pop-outs: opening a group in its own OS window, and closing windows the
 * layout no longer has a use for.
 *
 * dockview does the opening with `window.open(...)`: the pop-out page is loaded,
 * the group's live DOM is moved into it, and the returned `Window` is kept so
 * the group can be moved back when the window closes. Where `window.open` cannot
 * deliver a real window — a browser blocking the pop-up, or a platform where
 * dockview refuses the pop-out URL — dockview's very sensible but invisible
 * default is `handleBlockedPopout`: it re-docks the group where it came from,
 * fires `onDidOpenPopoutWindowFail` and logs to the console. Clicking "Popout"
 * therefore looks like it did nothing at all.
 *
 * `popoutGroup` turns that dead end into a visible one by falling back to a
 * floating group (dockview's in-app floating window), so the panel still
 * detaches from the layout the way the user asked for.
 *
 * `addPopoutGroup` resolves `false` for both the blocked and the
 * platform-refused cases, and rejects only on a genuine error (dockview catches
 * its own failures and returns `false`), so all three paths land in the same
 * fallback. The returned promise resolves `true` when a window was opened.
 */

/** dockview's pop-out page — the same one it falls back to itself. */
const POPOUT_URL = '/popout.html';

/**
 * Label the host gives a group's pop-out window.
 *
 * The pop-out URL carries the group id so the desktop build can name the window
 * after it (`popout_label` in `src-tauri/src/lib.rs`), which is what lets the app
 * find that window again: it lives in another webview, so no DOM handle can
 * reach it, and a window the page never adopted cannot close itself. The
 * sanitising rule matches the Rust side exactly.
 */
export function popoutLabelForGroup(groupId) {
  const safe = String(groupId ?? '').replace(/[^A-Za-z0-9_-]/g, '-');
  return safe ? `popout-${safe}` : null;
}

function popoutUrlForGroup(groupId) {
  if (groupId === undefined || groupId === null) return POPOUT_URL;
  return `${POPOUT_URL}?groupId=${encodeURIComponent(String(groupId))}`;
}

/**
 * Close the pop-out window the host opened for `groupId`, if there is one.
 *
 * `close()` rather than `destroy()`: it goes through the same path as the OS
 * close button, so a window that still has a page in it gets to close itself
 * (and dockview gets its panel back) before the window is torn down.
 */
export async function closePopoutWindowForGroup(groupId) {
  const label = popoutLabelForGroup(groupId);
  if (!label || !isTauri()) return false;
  try {
    const popoutWindow = await WebviewWindow.getByLabel(label);
    if (!popoutWindow) return false;
    await popoutWindow.close();
    return true;
  } catch (err) {
    console.warn(`dockview: could not close pop-out window ${label}:`, err);
    return false;
  }
}

/** Float a group that could not be popped out. Never throws: a failure here
 *  means the group stays docked, which is where it already is. */
function floatInstead(api, group) {
  // A group that is already floating (popping a floating group out is legal in
  // dockview) has nothing to gain from a second float.
  if (group?.api?.location?.type === 'floating') return;
  try {
    api.addFloatingGroup(group);
  } catch (err) {
    console.warn('dockview: could not float the panel either:', err);
  }
}

export function popoutGroup(api, group) {
  if (!api || !group) return Promise.resolve(false);

  // Edge groups are structural — dockview refuses to pop them out.
  if (group.api?.location?.type === 'edge') return Promise.resolve(false);

  const groupId = group.id;
  let result;
  try {
    result = api.addPopoutGroup(group, { popoutUrl: popoutUrlForGroup(groupId) });
  } catch (err) {
    console.warn('dockview: pop-out window could not be opened:', err);
    floatInstead(api, group);
    return Promise.resolve(false);
  }

  return Promise.resolve(result)
    .then((opened) => {
      if (!opened) {
        console.warn(
          'dockview: no pop-out window was created (pop-ups blocked, or the platform refused the pop-out URL) — floating the panel instead',
        );
        // The host can still have opened a window for a request dockview then
        // treated as blocked. Nothing will ever fill that window, so make sure
        // it does not stay on screen.
        void closePopoutWindowForGroup(groupId);
        floatInstead(api, group);
      }
      return opened;
    })
    .catch((err) => {
      console.warn('dockview: pop-out window could not be opened:', err);
      void closePopoutWindowForGroup(groupId);
      floatInstead(api, group);
      return false;
    });
}

/**
 * Close pop-out windows whose group has run out of panels.
 *
 * dockview disposes a pop-out window when its panels are *closed*, but it does
 * not when they merely move away: drag the only tab of a pop-out window back
 * into the main window and that window stays open, empty and useless.
 * `api.removeGroup` is the missing step — for a group in a pop-out window it
 * runs dockview's own teardown, which closes the window, and leaves the window
 * alone while other groups still live in it.
 *
 * Callers run this *after* the mutation that emptied the group has finished
 * (see `queueMicrotask` in DockLayout): during a mutation the same group is also
 * being torn down by dockview, and removing it twice is not a thing.
 */
export function closeEmptyPopoutGroups(api) {
  let closed = 0;
  for (const popout of api?.getPopouts?.() ?? []) {
    if (!popout?.group?.panels || popout.group.panels.length > 0) continue;
    try {
      api.removeGroup(popout.group);
      closed += 1;
    } catch (err) {
      console.warn('dockview: could not close an empty pop-out window:', err);
    }
  }
  return closed;
}
