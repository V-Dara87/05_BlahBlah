 
import { useCallback, useRef, memo, useEffect } from 'react';
import { DockviewReact } from 'dockview-react';
import { ExternalLink, Layers, Maximize2, Minimize2, X } from 'lucide-react';
import {
  ProjectDockPanel,
  PreviewDockPanel,
  InspectorDockPanel,
  TimelineDockPanel,
  DopesheetDockPanel,
  CurveEditorDockPanel,
  SilenceRemoverDockPanel,
  MixerDockPanel,
} from './panels';
import { useEditorContext } from './EditorContext';
import 'dockview-react/dist/styles/dockview.css';
import './dockview-unity-theme.css';
 
const LAYOUT_STORAGE_KEY = 'blahblah-dock-layout-v2';
const LEGACY_STORAGE_KEY = 'blahblah-dock-layout-v1';

// Empty fallback panel so unknown/removed panels from old saved layouts
// never cause dockview-react to crash with undefined component.
const FallbackPanel = () => null;

const DOCK_COMPONENTS = {
  project: ProjectDockPanel,
  preview: PreviewDockPanel,
  inspector: InspectorDockPanel,
  timeline: TimelineDockPanel,
  dopesheet: DopesheetDockPanel,
  curveEditor: CurveEditorDockPanel,
  silenceRemover: SilenceRemoverDockPanel,
  mixer: MixerDockPanel,
  // Fallbacks for removed tabs from previous builds
  clips: FallbackPanel,
};
 
function buildDefaultLayout(api) {
  const previewPanel = api.addPanel({
    id: 'preview',
    component: 'preview',
    title: 'Preview',
  });
 
  api.addPanel({
    id: 'project',
    component: 'project',
    title: 'Project',
    position: { direction: 'left', referencePanel: previewPanel },
    initialWidth: 280,
  });
 
  // (Clips tab removed — all project navigation now lives in the Project
  // panel; clips are visible on the timeline itself.)
 
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
  // this tab's content automatically, but does NOT steal focus from
  // whichever tab the user currently has active — see
  // useAutoFocusCurveTab in Dopesheet.jsx for the explicit focus trigger.
  api.addPanel({
    id: 'curveEditor',
    component: 'curveEditor',
    title: 'Curves',
    position: { direction: 'within', referencePanel: dopesheetPanel },
  });

  api.addPanel({
    id: 'silenceRemover',
    component: 'silenceRemover',
    title: 'Silence Remover',
    position: { direction: 'within', referencePanel: dopesheetPanel },
  });

  api.addPanel({
    id: 'mixer',
    component: 'mixer',
    title: 'Mixer',
    position: { direction: 'within', referencePanel: dopesheetPanel },
  });
}

const DockHeaderActions = memo(function DockHeaderActions({
  api,
  containerApi,
  group,
  activePanel,
  location,
}) {
  const isPopout = location?.type === 'popout';
  const isFloating = location?.type === 'floating';

  const handlePopout = useCallback(() => {
    containerApi.addPopoutGroup(group);
  }, [containerApi, group]);

  const handleFloat = useCallback(() => {
    containerApi.addFloatingGroup(group);
  }, [containerApi, group]);

  const handleMaximize = useCallback(() => {
    if (api.isMaximized()) {
      api.exitMaximized();
    } else {
      api.maximize();
    }
  }, [api]);

  const handleClose = useCallback(() => {
    if (activePanel) {
      activePanel.api.close();
    } else {
      api.close();
    }
  }, [activePanel, api]);

  return (
    <div className="dock-header-actions">
      {!isPopout && (
        <button
          className="dock-action-btn"
          onClick={handlePopout}
          title="Pop out to separate window (dual monitor)"
        >
          <ExternalLink size={12} />
        </button>
      )}
      {!isFloating && !isPopout && (
        <button
          className="dock-action-btn"
          onClick={handleFloat}
          title="Float panel"
        >
          <Layers size={12} />
        </button>
      )}
      {!isPopout && (
        <button
          className="dock-action-btn"
          onClick={handleMaximize}
          title={api.isMaximized() ? 'Restore panel size' : 'Maximize panel'}
        >
          {api.isMaximized() ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      )}
      <button
        className="dock-action-btn dock-close-btn"
        onClick={handleClose}
        title="Close tab"
      >
        <X size={12} />
      </button>
    </div>
  );
});

export const DockLayout = memo(function DockLayout() {
  const apiRef = useRef(null);
  const { setDockApi, setResetLayout } = useEditorContext();

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

    // Clean up legacy keys from previous builds
    localStorage.removeItem(LEGACY_STORAGE_KEY);
 
    let restored = false;
    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (saved) {
        api.fromJSON(JSON.parse(saved));
        restored = true;
        // Panels from older builds (e.g. the removed Clips tab) have no
        // registered component — drop them so the restored layout stays
        // functional.
        requestAnimationFrame(() => {
          api.panels.forEach((panel) => {
            if (!DOCK_COMPONENTS[panel.component]) {
              try {
                panel.api.removePanel(panel);
              } catch {
                // Panel may already be gone
              }
            }
          });
        });
      }
    } catch {
      // Corrupt/incompatible saved layout
    }
 
    if (!restored) {
      buildDefaultLayout(api);
    }
 
    api.onDidLayoutChange(() => persistLayout());
  }, [persistLayout, setDockApi]);
 
  const handleResetLayout = useCallback(() => {
    if (!apiRef.current) return;
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    apiRef.current.clear();
    buildDefaultLayout(apiRef.current);
  }, []);

  useEffect(() => {
    setResetLayout?.(handleResetLayout);
  }, [handleResetLayout, setResetLayout]);

  const getTabContextMenuItems = useCallback(() => [
    'popout',
    'float',
    'maximize',
    'separator',
    'close',
    'closeOthers',
    'closeAll',
  ], []);
 
  return (
    <div className="dock-root">
      <DockviewReact
        className="dockview-theme-dark dockview-theme-unity"
        components={DOCK_COMPONENTS}
        rightHeaderActionsComponent={DockHeaderActions}
        getTabContextMenuItems={getTabContextMenuItems}
        onReady={handleReady}
      />
    </div>
  );
});
 
 