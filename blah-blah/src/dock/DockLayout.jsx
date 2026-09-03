 
import { useCallback, useRef, memo } from 'react';
import { DockviewReact } from 'dockview-react';
import { RotateCcw } from 'lucide-react';
import {
  ProjectDockPanel,
  ClipsDockPanel,
  PreviewDockPanel,
  InspectorDockPanel,
  TimelineDockPanel,
  DopesheetDockPanel,
  CurveEditorDockPanel,
} from './panels';
import { useEditorContext } from './EditorContext';
import 'dockview-react/dist/styles/dockview.css';
import './dockview-unity-theme.css';
 
const LAYOUT_STORAGE_KEY = 'blahblah-dock-layout-v1';
 
const DOCK_COMPONENTS = {
  project: ProjectDockPanel,
  clips: ClipsDockPanel,
  preview: PreviewDockPanel,
  inspector: InspectorDockPanel,
  timeline: TimelineDockPanel,
  dopesheet: DopesheetDockPanel,
  curveEditor: CurveEditorDockPanel,
};
 
function buildDefaultLayout(api) {
  const previewPanel = api.addPanel({
    id: 'preview',
    component: 'preview',
    title: 'Game',
  });
 
  const projectPanel = api.addPanel({
    id: 'project',
    component: 'project',
    title: 'Project',
    position: { direction: 'left', referencePanel: previewPanel },
    initialWidth: 280,
  });
 
  api.addPanel({
    id: 'clips',
    component: 'clips',
    title: 'Clips',
    position: { direction: 'within', referencePanel: projectPanel },
  });
 
  api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: { direction: 'right', referencePanel: previewPanel },
    initialWidth: 310,
  });
 
  const timelinePanel = api.addPanel({
    id: 'timeline',
    component: 'timeline',
    title: 'Timeline',
    position: { direction: 'below', referencePanel: previewPanel },
    initialHeight: 280,
  });
 
  // Dopesheet tabs alongside Timeline (Spine 2D keeps its Dopesheet as a
  // tab next to the main timeline/tree panel rather than a separate
  // docked region) -- switching tabs doesn't disturb the Timeline's own
  // scroll/zoom state since dockview keeps each tab's component mounted.
  const dopesheetPanel = api.addPanel({
    id: 'dopesheet',
    component: 'dopesheet',
    title: 'Dopesheet',
    position: { direction: 'within', referencePanel: timelinePanel },
  });

  // Curve Editor — separate tab alongside Dopesheet. Shows the bezier
  // curve for the currently selected keyframe (shared via selectedKeyId
  // in EditorContext). Selecting a keyframe in the Dopesheet activates
  // this tab's content automatically.
  api.addPanel({
    id: 'curveEditor',
    component: 'curveEditor',
    title: 'Curves',
    position: { direction: 'within', referencePanel: dopesheetPanel },
  });
}export const DockLayout = memo(function DockLayout() {
  const apiRef = useRef(null);
  const { setDockApi } = useEditorContext();

  const persistLayout = useCallback(() => {
    if (!apiRef.current) return;
    try {
      const layout = apiRef.current.toJSON();
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Ignore storage failures
    }
  }, []);
 
  const handleReady = useCallback((event) => {
    const api = event.api;
    apiRef.current = api;
    setDockApi(api);
 
    let restored = false;
    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (saved) {
        api.fromJSON(JSON.parse(saved));
        restored = true;
      }
    } catch {
      // Corrupt/incompatible saved layout
    }
 
    if (!restored) {
      buildDefaultLayout(api);
    }
 
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
});
 
 