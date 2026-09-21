import { AUTOSAVE_DEFAULTS } from '../../../services/autosaveSettings';
import { saveAudioSettings } from '../../../services/audioSettings';
import { resetKeybindSettings } from '../../../services/keybindSettings';

/**
 * ============================================================================
 *  RESET-ALL REGISTRY  (Settings > System > "Reset all settings")
 * ============================================================================
 *
 *  Every global preference the Settings modal can change is listed here with
 *  the function that restores its defaults. "Reset all settings" simply runs
 *  every entry, and the confirmation dialog shows these labels — so the list
 *  is also what the person is told will change.
 *
 *  WHEN YOU ADD A NEW GLOBAL SETTING, ADD AN ENTRY HERE. If you forget, the
 *  setting keeps its value after "Reset all", which is a confusing bug.
 *
 *  WHY NOT JUST DELETE THE LOCALSTORAGE KEYS?
 *    The running app keeps its own live copy of most settings (autosave lives
 *    in React state in App.jsx, keybinds in a window event, the recording
 *    mic in a hook). Deleting keys would leave that live copy stale until the
 *    next reload. Each `reset` below therefore goes through the SAME path the
 *    setting's own tab uses to change it, so the effect is immediate.
 *
 *  `reset(ctx)` receives the same `ctx` object the modal builds in
 *  SettingsModal.jsx (onSettingsChanged, onAutosaveSettingsChange, ...).
 *
 *  WHAT IS DELIBERATELY NOT HERE
 *    - Project resolution: it belongs to the project, not to the app.
 *    - The user's own data: projects, the shared asset library, and the recent
 *      projects list. These live in storage too, but they are content, not
 *      preferences — resetting settings must never delete them.
 *    - Window/dock layout: it has its own "Reset Layout" command in the
 *      Window menu.
 * ============================================================================
 */
export const RESETTABLE_SETTINGS = [
  {
    id: 'autosave',
    label: 'Autosave',
    reset: (ctx) => ctx.onAutosaveSettingsChange?.({ ...AUTOSAVE_DEFAULTS }),
  },
  {
    id: 'shortcuts',
    label: 'Keyboard shortcuts',
    // Also broadcasts 'blahblah:keybinds-changed', so menus and the shortcut
    // handler update immediately.
    reset: () => resetKeybindSettings(),
  },
  {
    id: 'audio',
    label: 'Microphone input',
    reset: (ctx) => {
      const defaults = { inputDeviceId: 'default' };
      saveAudioSettings(defaults);
      ctx.onSettingsChanged?.(defaults);
    },
  },
];

/**
 * Restore every entry in RESETTABLE_SETTINGS to its default. One failing entry
 * never blocks the others. Returns the labels that failed (empty on success).
 */
export function resetAllSettings(ctx = {}) {
  const failed = [];
  for (const entry of RESETTABLE_SETTINGS) {
    try {
      entry.reset(ctx);
    } catch (err) {
      console.warn(`[settings] Could not reset "${entry.label}":`, err);
      failed.push(entry.label);
    }
  }
  return failed;
}