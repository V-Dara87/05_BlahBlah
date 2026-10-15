/**
 * Registry of all available dock windows in BlahBlah.
 * Matches DOCK_COMPONENTS in DockLayout.jsx.
 */
export const AVAILABLE_DOCK_WINDOWS = [
  { id: 'project', component: 'project', title: 'Project', iconName: 'FolderOpen', desc: 'Media, prefabs & scripts' },
  { id: 'preview', component: 'preview', title: 'Preview', iconName: 'PlaySquare', desc: 'Video canvas player' },
  { id: 'inspector', component: 'inspector', title: 'Inspector', iconName: 'Sliders', desc: 'Entity properties & components' },
  { id: 'timeline', component: 'timeline', title: 'Timeline', iconName: 'Clock', desc: 'Multi-track sequencer' },
  { id: 'dopesheet', component: 'dopesheet', title: 'Dopesheet', iconName: 'Layers', desc: 'Keyframe timing' },
  { id: 'curveEditor', component: 'curveEditor', title: 'Curves', iconName: 'Activity', desc: 'Curve editor' },
  { id: 'silenceRemover', component: 'silenceRemover', title: 'Silence Remover', iconName: 'Scissors', desc: 'Audio silence detection' },
  { id: 'mixer', component: 'mixer', title: 'Mixer', iconName: 'Volume2', desc: 'Audio track mixer' },
  { id: 'console', component: 'console', title: 'Console', iconName: 'Terminal', desc: 'Output logs & debug' },
];

/**
 * Core logic to open or add a window to a specific dock group.
 * Exported for clean testing and reuse.
 */
export function openOrAddWindowToGroup({ win, containerApi, group }) {
  if (!containerApi || !group) return;

  // 1. If already active in THIS group, just focus it
  const inThisGroup = containerApi.panels?.find(
    (p) => p.component === win.component && (p.group?.id === group.id || p.group === group)
  );
  if (inThisGroup) {
    inThisGroup.api?.setActive?.();
    return inThisGroup;
  }

  // 2. If open in ANOTHER group elsewhere, move it into this group
  const existingElsewhere = containerApi.panels?.find(
    (p) => p.component === win.component
  );
  if (existingElsewhere) {
    try {
      if (typeof existingElsewhere.api?.moveTo === 'function') {
        existingElsewhere.api.moveTo({ group });
        existingElsewhere.api.setActive?.();
        return existingElsewhere;
      }
    } catch (err) {
      console.warn('dockview: moveTo failed, falling back to addPanel:', err);
    }
  }

  // 3. Not open anywhere (or moveTo fallback): add to this group
  const panelId = containerApi.getPanel?.(win.id) ? `${win.id}-${Date.now()}` : win.id;
  return containerApi.addPanel?.({
    id: panelId,
    component: win.component,
    title: win.title,
    position: { referenceGroup: group, direction: 'within' },
  });
}

/**
 * Core logic to add a new instance (duplicate tab) to a specific dock group.
 */
export function addNewWindowInstanceToGroup({ win, containerApi, group }) {
  if (!containerApi || !group) return;

  const count = (containerApi.panels || []).filter((p) => p.component === win.component).length;
  const title = count > 0 ? `${win.title} (${count + 1})` : win.title;

  return containerApi.addPanel?.({
    id: `${win.component}-${Date.now()}`,
    component: win.component,
    title,
    position: { referenceGroup: group, direction: 'within' },
  });
}
