import { MonitorPlay, Save, Mic, Keyboard, Cpu, Palette } from 'lucide-react';
import { ProjectTab } from './ProjectTab';
import { AutosaveTab } from './AutosaveTab';
import { AppearanceTab } from './AppearanceTab';
import { AudioTab } from './AudioTab';
import { KeyboardShortcutsTab } from './KeyboardShortcutsTab';
import { SystemTab } from './SystemTab';
import { resetAllSettings } from './resetAllSettings';

/**
 * ============================================================================
 *  SETTINGS TAB REGISTRY
 * ============================================================================
 *
 *  This file is the ONE place that decides which tabs the Settings modal shows,
 *  which section each belongs to, and in what order. SettingsModal.jsx is
 *  generic: it reads SETTINGS_SECTIONS + SETTINGS_TABS and renders whatever is
 *  listed here, so adding or moving a tab should never require editing it.
 *
 *  HOW TO ADD A NEW SETTINGS TAB
 *  ----------------------------------------------------------------------------
 *  1. PICK A SECTION. Use the guide in SETTINGS_SECTIONS below. If nothing fits,
 *     add a new section there first (keep the list short — 4 to 5 max).
 *
 *  2. DECIDE THE SCOPE. Every tab is exactly one of:
 *       'global'  App-wide preference, stored in localStorage, the same for
 *                 every project (autosave, shortcuts, mic, editor defaults).
 *                 This is the default for almost everything.
 *       'project' Saved INSIDE the project (project.json), so it travels with
 *                 the project folder. Only use this for values that describe
 *                 the document itself (today: canvas resolution).
 *     The modal shows a "Global" / "This project" badge from this value, so it
 *     must be honest.
 *
 *  3. PUT PERSISTENCE IN A SERVICE, NOT IN THE TAB. For a new global setting:
 *       - create src/services/<name>Settings.js. Copy the shape of
 *         services/autosaveSettings.js: a frozen DEFAULTS object, a
 *         sanitize() that clamps values and fills missing keys, load() and
 *         save(), and a versioned localStorage key such as
 *         'blahblah.<name>Settings.v1'.
 *       - if the rest of the app must react live, add hooks/use<Name>Settings.js
 *         (copy hooks/useAutosaveSettings.js), call it once in App.jsx, and pass
 *         the value + updater down through SettingsModal's props.
 *     Tabs should stay thin: render controls, call the updater, offer a
 *     "Reset to Defaults" button. Never put storage code inside a tab.
 *     ALSO add an entry to settings/resetAllSettings.js, so System > "Reset all
 *     settings" restores your new setting too (skip this only for 'project'
 *     scope values, which are not app preferences).
 *
 *  4. CREATE THE TAB COMPONENT in this folder: <Name>Tab.jsx, exporting
 *     `function <Name>Tab(props)`. It renders a single
 *     <div className="modal-body settings-body"> root (see the existing tabs).
 *     Use the shared classes in settings-modal.css (settings-check-row,
 *     settings-hint-block, settings-group-dimmed, ...) instead of inline styles
 *     and hard-coded colors; use the --unity-* CSS variables for anything new.
 *
 *  5. REGISTER IT in SETTINGS_TABS below. Fields:
 *       id         unique, stable string (used for state, keys, and search)
 *       label      text in the sidebar
 *       icon       a lucide-react icon component
 *       section    a `id` from SETTINGS_SECTIONS
 *       scope      'global' | 'project'
 *       subtitle   the one-line description under the "Settings" title
 *       keywords   optional extra words the sidebar search should match
 *       Component  the tab component
 *       getProps   (ctx) => props for that component. `ctx` is the object the
 *                  modal receives from App.jsx (resolution, autosaveSettings,
 *                  onSettingsChanged, ...). Return {} if the tab needs nothing.
 *
 *  6. IF THE TAB NEEDS NEW DATA FROM App.jsx, add the prop to SettingsModal's
 *     signature, pass it in App.jsx, and read it in your getProps. That is the
 *     only case where SettingsModal.jsx changes.
 *
 *  FILE CHECKLIST for a typical new global setting:
 *     [ ] src/services/<name>Settings.js         (persistence)
 *     [ ] src/hooks/use<Name>Settings.js         (only if the app reacts live)
 *     [ ] src/components/modals/settings/<Name>Tab.jsx
 *     [ ] src/components/modals/settings/resetAllSettings.js   (add a reset entry)
 *     [ ] src/components/modals/settings/settingsTabs.js   (this file: register)
 *     [ ] src/App.jsx                            (only if a hook was added)
 *     [ ] the place that should USE the value    (otherwise it does nothing)
 *
 *  Tab order within a section is simply the order of entries in SETTINGS_TABS.
 * ============================================================================
 */

/**
 * Sections group tabs in the sidebar, in this order. A section with no
 * registered tabs is hidden automatically, so it is safe to declare a section
 * before its first tab exists.
 */
export const SETTINGS_SECTIONS = [
  {
    id: 'general',
    label: 'General',
    // Things about the project itself and how the app saves it.
    // Belongs here: canvas/project defaults, autosave, preferred external editor,
    // Hub/recent-projects behavior.
    // Does not belong: anything about the timeline or media processing.
  },
  {
    id: 'appearance',
    label: 'Appearance',
    // How the editor LOOKS. Everything here is global, never per project: a
    // theme belongs to the person and the machine, not to the document, and it
    // applies to the Hub screen as well.
    // Belongs here: the accent-colour theme.
    // Does not belong: panel/dock arrangement (Window > Reset Layout owns it).
  },
  {
    id: 'editor',
    label: 'Editor',
    // How the editing surface behaves and how you drive it.
    // Belongs here: timeline defaults (snapping, zoom, new-clip length), undo
    // depth, and keyboard shortcuts.
    // Does not belong: audio/video processing options (use Media).
  },
  {
    id: 'media',
    label: 'Media',
    // Anything that captures or processes audio/video.
    // Belongs here: microphone/recording input, export defaults, silence-remover
    // defaults.
    // Does not belong: editing-surface behavior (use Editor).
  },
  {
    id: 'system',
    label: 'System',
    // The desktop environment and background tooling; diagnostics that change
    // nothing about the project.
    // Belongs here: runtime info, FFmpeg sidecar status, reset-all actions.
  },
];

/**
 * Every tab, in display order. See the header comment for the field guide.
 */
export const SETTINGS_TABS = [
  // ---- General -------------------------------------------------------------
  {
    id: 'project',
    label: 'Project',
    icon: MonitorPlay,
    section: 'general',
    scope: 'project',
    subtitle: 'Project canvas resolution',
    keywords: ['resolution', 'canvas', 'size', 'aspect', 'width', 'height', '1080p', '4k'],
    Component: ProjectTab,
    getProps: (ctx) => ({
      resolution: ctx.resolution,
      onResolutionChange: ctx.onResolutionChange,
    }),
  },
  {
    id: 'autosave',
    label: 'Autosave',
    icon: Save,
    section: 'general',
    scope: 'global',
    subtitle: 'When and how the project is saved to disk',
    keywords: ['save', 'delay', 'disk', 'backup', 'blur'],
    Component: AutosaveTab,
    getProps: (ctx) => ({
      settings: ctx.autosaveSettings,
      onChange: ctx.onAutosaveSettingsChange,
    }),
  },

  // ---- Appearance ----------------------------------------------------------
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    section: 'appearance',
    scope: 'global',
    subtitle: 'Accent colour theme',
    keywords: ['theme', 'color', 'colour', 'accent', 'palette', 'preset', 'harmony', 'look'],
    Component: AppearanceTab,
    getProps: (ctx) => ({
      settings: ctx.themeSettings,
      onChange: ctx.onThemeSettingsChange,
    }),
  },

  // ---- Editor --------------------------------------------------------------
  {
    id: 'shortcuts',
    label: 'Keyboard Shortcuts',
    icon: Keyboard,
    section: 'editor',
    scope: 'global',
    subtitle: 'Customize your keyboard shortcuts',
    keywords: ['keys', 'keybind', 'hotkey', 'binding', 'rebind'],
    Component: KeyboardShortcutsTab,
    getProps: () => ({}),
  },

  // ---- Media ---------------------------------------------------------------
  {
    id: 'audio',
    label: 'Audio',
    icon: Mic,
    section: 'media',
    scope: 'global',
    subtitle: 'Audio input device for voice recording',
    keywords: ['microphone', 'mic', 'input', 'device', 'recording', 'level'],
    Component: AudioTab,
    getProps: (ctx) => ({ onSettingsChanged: ctx.onSettingsChanged }),
  },

  // ---- System --------------------------------------------------------------
  {
    id: 'system',
    label: 'System',
    icon: Cpu,
    section: 'system',
    scope: 'global',
    subtitle: 'Desktop environment and background sidecars',
    keywords: ['ffmpeg', 'sidecar', 'tauri', 'desktop', 'runtime', 'diagnostics'],
    Component: SystemTab,
    getProps: (ctx) => ({
      onResetAll: () => resetAllSettings(ctx),
      // Global editor preferences (services/editorSettings.js) — exposed here
      // for the timeline's canvas renderer toggle; see SystemTab.jsx.
      editorSettings: ctx.editorSettings,
      onEditorSettingsChange: ctx.onEditorSettingsChange,
    }),
  },
];

/** The tab shown when the modal first opens. */
export const DEFAULT_SETTINGS_TAB_ID = 'project';

/** Look up one tab by id (undefined if the id is unknown). */
export function getSettingsTab(id) {
  return SETTINGS_TABS.find((tab) => tab.id === id);
}

/**
 * Group tabs by section for the sidebar, optionally filtered by a search
 * string. Matches the label, the section name, and any `keywords`. Sections
 * that end up empty are omitted. Returns [{ section, tabs }, ...] in
 * SETTINGS_SECTIONS order.
 */
export function groupSettingsTabs(query = '') {
  const needle = String(query).trim().toLowerCase();
  const matches = (tab, section) => {
    if (!needle) return true;
    const haystack = [tab.label, section.label, ...(tab.keywords || [])].join(' ').toLowerCase();
    return haystack.includes(needle);
  };

  return SETTINGS_SECTIONS.map((section) => ({
    section,
    tabs: SETTINGS_TABS.filter((tab) => tab.section === section.id && matches(tab, section)),
  })).filter((group) => group.tabs.length > 0);
}