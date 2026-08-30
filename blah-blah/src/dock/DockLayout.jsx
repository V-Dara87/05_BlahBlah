import { useCallback, useRef } from 'react';
import { DockviewReact } from 'dockview-react';
import { RotateCcw } from 'lucide-react';
import {
  ProjectDockPanel,
  PreviewDockPanel,
  InspectorDockPanel,
  TimelineDockPanel,
} from './panels';
import 'dockview-react/dist/styles/dockview.css';
import './dockview-unity-theme.css';

const LAYOUT_STORAGE_KEY = 'blahblah-dock-layout-v1';

// Registered panel components, keyed by the string dockview stores in the
// saved layout JSON. Keep these keys stable — renaming one orphans any
// layout a user already saved to localStorage.
const DOCK_COMPONENTS = {
  project: ProjectDockPanel,
  preview: PreviewDockPanel,
  inspector: InspectorDockPanel,
  timeline: TimelineDockPanel,
};

function buildDefaultLayout(api) {
  // Mirrors the original fixed 3-column + bottom-timeline layout, but every
  // panel is now a real dockview panel: draggable, splittable, tabbable.
  const previewPanel = api.addPanel({
    id: 'preview',
    component: 'preview',
    title: 'Game',
  });

  api.addPanel({
    id: 'project',
    component: 'project',
    title: 'Project',
    position: { direction: 'left', referencePanel: previewPanel },
    initialWidth: 280,
  });

  api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: { direction: 'right', referencePanel: previewPanel },
    initialWidth: 310,
  });

  api.addPanel({
    id: 'timeline',
    component: 'timeline',
    title: 'Timeline',
    position: { direction: 'below', referencePanel: previewPanel },
    initialHeight: 280,
  });
}

export function DockLayout() {
  const apiRef = useRef(null);

  const persistLayout = useCallback(() => {
    if (!apiRef.current) return;
    try {
      const layout = apiRef.current.toJSON();
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Ignore storage failures (private browsing, quota, etc.) - layout
      // just won't persist across reloads, which is a harmless degrade.
    }
  }, []);

  const handleReady = useCallback((event) => {
    const api = event.api;
    apiRef.current = api;

    let restored = false;
    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (saved) {
        api.fromJSON(JSON.parse(saved));
        restored = true;
      }
    } catch {
      // Corrupt/incompatible saved layout - fall through to default.
    }

    if (!restored) {
      buildDefaultLayout(api);
    }

    // Save on every layout change: panel moved, resized, split, tab
    // reordered, panel closed, etc. This is how "you can move things around
    // like Unity, and it remembers" actually works.
    api.onDidLayoutChange(() => persistLayout());
  }, [persistLayout]);

  const handleResetLayout = useCallback(() => {
    if (!apiRef.current) return;
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    apiRef.current.clear();
    buildDefaultLayout(apiRef.current);
  }, []);

  return (
    <div className="dock-root">
      <button
        className="dock-reset-btn"
        onClick={handleResetLayout}
        title="Reset panel layout to default"
      >
        <RotateCcw size={12} />
        <span>Reset Layout</span>
      </button>
      <DockviewReact
        className="dockview-theme-unity"
        components={DOCK_COMPONENTS}
        onReady={handleReady}
      />
    </div>
  );
}
