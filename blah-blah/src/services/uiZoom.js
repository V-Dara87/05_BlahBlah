import { useSyncExternalStore } from 'react';
import { isTauri } from './tauriFsAdapter';

/**
 * Whole-app UI zoom (the header +/- buttons).
 *
 * - Desktop (Tauri): asks the Rust side (`set_ui_zoom`), which multiplies the
 *   user zoom into the automatic window-fit zoom. This is a real webview zoom,
 *   so pointer coordinates, canvases and the dock layout stay consistent.
 * - Browser: sets the CSS `zoom` property on <html>.
 *
 * The timeline's own zoom (Ctrl+wheel, timeline toolbar, `-` / `=`) is separate.
 */

const STORAGE_KEY = 'blahblah.uiZoom';
export const UI_ZOOM_MIN = 0.5;
export const UI_ZOOM_MAX = 2;
export const UI_ZOOM_STEP = 0.1;

const clampZoom = (v) =>
  Math.round(Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, v)) * 100) / 100;

function loadZoom() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw == null ? 1 : parseFloat(raw);
    return Number.isFinite(n) ? clampZoom(n) : 1;
  } catch {
    return 1;
  }
}

let currentZoom = 1;
let initialized = false;
const listeners = new Set();

async function applyZoom(value) {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_ui_zoom', { factor: value });
    } catch (err) {
      console.warn('Failed to apply UI zoom:', err);
    }
  } else if (typeof document !== 'undefined') {
    document.documentElement.style.zoom = value === 1 ? '' : String(value);
  }
}

// Shortcuts: Ctrl/Cmd + '-' zoom out, Ctrl/Cmd + '=' (or '+') zoom in,
// Ctrl/Cmd + '0' reset. Capture phase + preventDefault so the webview's own
// native zoom never double-applies. Timeline keys ('-' / '=' without a
// modifier, Ctrl+wheel) are untouched.
function handleZoomShortcut(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    zoomUiOut();
  } else if (e.key === '=' || e.key === '+') {
    e.preventDefault();
    zoomUiIn();
  } else if (e.key === '0') {
    e.preventDefault();
    resetUiZoom();
  }
}

function initUiZoom() {
  if (initialized) return;
  initialized = true;
  currentZoom = loadZoom();
  if (currentZoom !== 1) applyZoom(currentZoom);
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleZoomShortcut, true);
  }
}

export function getUiZoom() {
  initUiZoom();
  return currentZoom;
}

export function setUiZoom(value) {
  initUiZoom();
  const next = clampZoom(value);
  if (next === currentZoom) return;
  currentZoom = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    /* storage unavailable - zoom still works for this session */
  }
  applyZoom(next);
  listeners.forEach((fn) => fn());
}

export const zoomUiIn = () => setUiZoom(getUiZoom() + UI_ZOOM_STEP);
export const zoomUiOut = () => setUiZoom(getUiZoom() - UI_ZOOM_STEP);
export const resetUiZoom = () => setUiZoom(1);

function subscribe(fn) {
  initUiZoom();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useUiZoom() {
  const zoom = useSyncExternalStore(subscribe, getUiZoom, () => 1);
  return { zoom, zoomIn: zoomUiIn, zoomOut: zoomUiOut, resetZoom: resetUiZoom };
}