import {
  Save, Undo2, Redo2, Scissors, Trash2, Copy, ClipboardPaste, Play, SkipBack,
  SkipForward, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Magnet, Maximize2,
  MousePointer2, Layers, Download, Settings, Code, FilePlus, FolderOpen, Sliders,
  PlaySquare, Clock, Activity, Volume2, Terminal, Package, X,
} from 'lucide-react';

/**
 * The catalog of everything a radial-menu slice can run.
 *
 * This file holds only STATIC info (id, labels, group, icon, hint). The live
 * part - what each id actually does and whether it is currently disabled -
 * lives in components/pie/PieMenu.jsx (`buildRunners`), because it needs
 * App's handlers and the playback store. Settings -> Radial Menu reads this
 * catalog to fill its dropdowns without needing any of that.
 *
 * Ids are stored in the user's saved wheel, so NEVER rename one. Where an
 * action already has a keyboard shortcut, the id matches the id in
 * services/keybindSettings.js, which lets the UI show the user's real binding.
 *
 * To add an action: add one entry here, then one runner in `buildRunners`.
 *   id     stable key
 *   label  full name (Settings dropdown)
 *   short  short name drawn on the slice
 *   group  dropdown section (keep entries of a group together)
 *   hint   one line shown in the wheel's hub
 *   icon   lucide component
 */
export const PIE_ACTION_CATALOG = [
  // Playback
  { id: 'togglePlay', group: 'Playback', label: 'Play / Pause', short: 'Play / Pause', hint: 'Start or stop playback', icon: Play },
  { id: 'seekBack', group: 'Playback', label: 'Step Back', short: 'Step back', hint: 'Back one frame', icon: ChevronLeft },
  { id: 'seekForward', group: 'Playback', label: 'Step Forward', short: 'Step forward', hint: 'Forward one frame', icon: ChevronRight },
  { id: 'jumpToStart', group: 'Playback', label: 'Jump to Start', short: 'To start', hint: 'Move the playhead to 0:00', icon: SkipBack },
  { id: 'jumpToEnd', group: 'Playback', label: 'Jump to End', short: 'To end', hint: 'Move the playhead to the end', icon: SkipForward },

  // Timeline editing
  { id: 'splitSelected', group: 'Timeline', label: 'Split Clip (Cut)', short: 'Split', hint: 'Cut the selected clip at the playhead', icon: Scissors },
  { id: 'deleteSelected', group: 'Timeline', label: 'Delete Clip', short: 'Delete', hint: 'Delete the selected clip(s)', icon: Trash2 },
  { id: 'rippleDeleteBefore', group: 'Timeline', label: 'Ripple Trim (Before Playhead)', short: 'Trim before', hint: 'Remove the part before the playhead and close the gap', icon: Scissors },
  { id: 'rippleDeleteAfter', group: 'Timeline', label: 'Ripple Trim (After Playhead)', short: 'Trim after', hint: 'Remove the part after the playhead', icon: Scissors },
  { id: 'cutSilence', group: 'Timeline', label: 'Cut Silence...', short: 'Cut silence', hint: 'Open the Silence Remover for the selected clip', icon: Scissors },
  { id: 'addTransition', group: 'Timeline', label: 'Add Transition', short: 'Transition', hint: 'Add a transition clip', icon: Layers },
  { id: 'toggleSnapping', group: 'Timeline', label: 'Toggle Snapping', short: 'Snapping', hint: 'Turn timeline snapping on or off', icon: Magnet },
  { id: 'zoomIn', group: 'Timeline', label: 'Zoom In', short: 'Zoom in', hint: 'Zoom the timeline in', icon: ZoomIn },
  { id: 'zoomOut', group: 'Timeline', label: 'Zoom Out', short: 'Zoom out', hint: 'Zoom the timeline out', icon: ZoomOut },
  { id: 'centerOnPlayhead', group: 'Timeline', label: 'Center View on Playhead', short: 'Center view', hint: 'Scroll the timeline to the playhead', icon: Maximize2 },
  { id: 'setInPoint', group: 'Timeline', label: 'Set Export In Point', short: 'In point', hint: 'Start the export range at the playhead', icon: ChevronLeft },
  { id: 'setOutPoint', group: 'Timeline', label: 'Set Export Out Point', short: 'Out point', hint: 'End the export range at the playhead', icon: ChevronRight },

  // Selection / clipboard
  { id: 'selectAll', group: 'Selection', label: 'Select All', short: 'Select all', hint: 'Select every clip', icon: MousePointer2 },
  { id: 'clearSelection', group: 'Selection', label: 'Deselect', short: 'Deselect', hint: 'Clear the selection', icon: X },
  { id: 'duplicateSelected', group: 'Selection', label: 'Duplicate Clip', short: 'Duplicate', hint: 'Duplicate the selected clip(s)', icon: Copy },
  { id: 'copySelected', group: 'Selection', label: 'Copy Clip(s)', short: 'Copy', hint: 'Copy the selected clip(s)', icon: Copy },
  { id: 'cutSelected', group: 'Selection', label: 'Cut Clip(s)', short: 'Cut', hint: 'Copy then delete the selected clip(s)', icon: Scissors },
  { id: 'pasteClips', group: 'Selection', label: 'Paste Clip(s)', short: 'Paste', hint: 'Paste at the playhead', icon: ClipboardPaste },

  // Project
  { id: 'saveProject', group: 'Project', label: 'Save Project', short: 'Save', hint: 'Save to the project folder', icon: Save },
  { id: 'undo', group: 'Project', label: 'Undo', short: 'Undo', hint: 'Undo the last change', icon: Undo2 },
  { id: 'redo', group: 'Project', label: 'Redo', short: 'Redo', hint: 'Redo the change you undid', icon: Redo2 },
  { id: 'newProject', group: 'Project', label: 'New Project...', short: 'New project', hint: 'Start a new project', icon: FilePlus },
  { id: 'openProject', group: 'Project', label: 'Open Project...', short: 'Open project', hint: 'Choose a project folder', icon: FolderOpen },
  { id: 'exportRender', group: 'Project', label: 'Export Render...', short: 'Export', hint: 'Open the export dialog', icon: Download },
  { id: 'projectCode', group: 'Project', label: 'Project Code', short: 'Project code', hint: 'View the project as JSON', icon: Code },
  { id: 'packageManager', group: 'Project', label: 'Package Manager...', short: 'Packages', hint: 'Browse and install packages', icon: Package },
  { id: 'openSettings', group: 'Project', label: 'Settings', short: 'Settings', hint: 'Open the Settings window', icon: Settings },

  // Windows
  { id: 'panel-inspector', group: 'Windows', label: 'Inspector', short: 'Inspector', hint: 'Show the Inspector window', icon: Sliders },
  { id: 'panel-preview', group: 'Windows', label: 'Preview', short: 'Preview', hint: 'Show the Preview window', icon: PlaySquare },
  { id: 'panel-project', group: 'Windows', label: 'Project', short: 'Project', hint: 'Show the Project window', icon: FolderOpen },
  { id: 'panel-timeline', group: 'Windows', label: 'Timeline', short: 'Timeline', hint: 'Show the Timeline window', icon: Clock },
  { id: 'panel-dopesheet', group: 'Windows', label: 'Dopesheet', short: 'Dopesheet', hint: 'Show the Dopesheet window', icon: Layers },
  { id: 'panel-curveEditor', group: 'Windows', label: 'Curves', short: 'Curves', hint: 'Show the Curves window', icon: Activity },
  { id: 'panel-silenceRemover', group: 'Windows', label: 'Silence Remover', short: 'Silence remover', hint: 'Show the Silence Remover window', icon: Scissors },
  { id: 'panel-mixer', group: 'Windows', label: 'Mixer', short: 'Mixer', hint: 'Show the Mixer window', icon: Volume2 },
  { id: 'panel-console', group: 'Windows', label: 'Console', short: 'Console', hint: 'Show the Console window', icon: Terminal },
];

const BY_ID = new Map(PIE_ACTION_CATALOG.map((a) => [a.id, a]));

export function getPieAction(id) {
  return BY_ID.get(id) || null;
}

/** Catalog entries grouped for a <select> with <optgroup>s, in catalog order. */
export function groupPieActions() {
  const groups = [];
  PIE_ACTION_CATALOG.forEach((action) => {
    const last = groups[groups.length - 1];
    if (!last || last.name !== action.group) groups.push({ name: action.group, items: [action] });
    else last.items.push(action);
  });
  return groups;
}

// Which dock panel each `panel-*` action opens, and the tab title to give it.
export const PIE_PANEL_TITLES = {
  inspector: 'Inspector',
  preview: 'Preview',
  project: 'Project',
  timeline: 'Timeline',
  dopesheet: 'Dopesheet',
  curveEditor: 'Curves',
  silenceRemover: 'Silence Remover',
  mixer: 'Mixer',
  console: 'Console',
};