/**
 * systemFonts.js — best-effort access to the fonts actually installed on
 * the user's machine, for the Text Component's Font Family picker.
 *
 * Backed by the Local Font Access API (`window.queryLocalFonts()`), which
 * is only available in Chromium-based engines (Chrome/Edge desktop, and
 * Tauri's WebView2 on Windows) behind a one-time permission prompt —
 * WebKit (macOS/Linux Tauri, Safari) and Firefox don't implement it at
 * all. There is no reliable way to detect "will the permission prompt
 * succeed" ahead of calling it, so this is always attempted opportunistically
 * and any failure (unsupported, denied, blocked by permissions policy)
 * quietly resolves to an empty list rather than throwing — callers should
 * merge the result with FALLBACK_FONT_FAMILIES rather than depend on it.
 */
 
/** Small curated fallback list — always available, no permission needed. */
export const FALLBACK_FONT_FAMILIES = [
  'Inter',
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
  'Impact',
];
 
/** True when this browser/webview exposes the Local Font Access API at all. */
export function supportsLocalFontAccess() {
  return typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function';
}
 
/**
 * Requests the OS font list from the browser (triggers a native permission
 * prompt the first time, per-origin). Resolves to a sorted, de-duplicated
 * array of family names — e.g. ["Arial", "Calibri", "Comic Sans MS", ...] —
 * or an empty array if unsupported, denied, or the call otherwise fails.
 * Never throws.
 */
export async function queryInstalledFontFamilies() {
  if (!supportsLocalFontAccess()) return [];
  try {
    const fonts = await window.queryLocalFonts();
    const families = new Set();
    for (const f of fonts) {
      if (f?.family) families.add(f.family);
    }
    return Array.from(families).sort((a, b) => a.localeCompare(b));
  } catch {
    // Permission denied, user cancelled the prompt, or the call is blocked
    // by a Permissions-Policy header — all treated the same: no PC fonts,
    // fall back to the curated list.
    return [];
  }
}