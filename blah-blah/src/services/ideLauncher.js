import { isTauri } from './tauriFsAdapter';

/**
 * External-editor / Explorer launchers (P1-3) — one-click "Open in VS
 * Code / Cursor / Explorer" for the current project folder.
 *
 * Desktop-only by design: there is no filesystem path in a plain browser,
 * so every function no-ops when !isTauri() or when the caller has no
 * `path` to launch from. All real work goes through @tauri-apps/plugin-opener
 * (openPath / openUrl / revealItemInDir) so the OS — not the webview —
 * decides which app handles the request.
 */

function normalizePathForUri(p) {
  // Custom-protocol file URIs (vscode://, cursor://) want forward-slash
  // absolute paths; percent-encode the rest.
  return String(p || '').replace(/\\/g, '/');
}

function encodedFileUri(p) {
  return encodeURI(normalizePathForUri(p));
}

/** Open the folder in the OS file manager. */
export async function openProjectInExplorer(projectPath) {
  if (!isTauri() || !projectPath) return;
  try {
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(projectPath);
  } catch (err) {
    console.warn('Could not open folder in Explorer:', err);
  }
}

/** Open the folder in VS Code (vscode:// deep link). */
export async function openProjectInVsCode(projectPath) {
  if (!isTauri() || !projectPath) return;
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(`vscode://file/${encodedFileUri(projectPath)}`);
  } catch (err) {
    console.warn('Could not open folder in VS Code:', err);
  }
}

/** Open the folder in Cursor (cursor:// deep link). */
export async function openProjectInCursor(projectPath) {
  if (!isTauri() || !projectPath) return;
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(`cursor://file/${encodedFileUri(projectPath)}`);
  } catch (err) {
    console.warn('Could not open folder in Cursor:', err);
  }
}
