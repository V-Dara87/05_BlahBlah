import { useCallback, useEffect, useRef } from 'react';
 
/**
 * useDockPanels — dockview panel API + layout/open/focus/float/popout.
 *
 * Owns the dockview API ref (set by DockLayout on ready) and everything
 * that operates on it: opening/focusing a panel by component name, adding
 * a second instance of a panel, popping a panel out into its own OS
 * window, floating it within the app, focusing a panel by id (used by
 * Dopesheet/Curve Editor cross-linking), and resetting the whole layout.
 * Also owns the global Alt+P / Alt+F hotkeys for popout/float, since they
 * just call the handlers this hook already defines.
 *
 * Extracted out of App.jsx during the shell split. Pure UI-chrome state —
 * none of it is part of the undo-scoped document model.
 */
export function useDockPanels() {
  // Dockview API ref — set by DockLayout on ready, used by focusDockPanel
  const dockApiRef = useRef(null);
  const setDockApi = useCallback((api) => { dockApiRef.current = api; }, []);
 
  const resetLayoutRef = useRef(null);
  const setResetLayout = useCallback((fn) => { resetLayoutRef.current = fn; }, []);
  const handleResetLayout = useCallback(() => {
    resetLayoutRef.current?.();
  }, []);
 
  const openOrFocusPanel = useCallback((componentName, defaultTitle) => {
    const api = dockApiRef.current;
    if (!api) return;
    const existing = api.panels.find((p) => p.component === componentName);
    if (existing) {
      existing.api.setActive();
    } else {
      const refPanel = api.panels[0];
      api.addPanel({
        id: `${componentName}-${Date.now()}`,
        component: componentName,
        title: defaultTitle,
        position: refPanel ? { direction: 'within', referencePanel: refPanel } : undefined,
      });
    }
  }, []);
 
  const addNewPanelInstance = useCallback((componentName, defaultTitle) => {
    const api = dockApiRef.current;
    if (!api) return;
    const count = api.panels.filter((p) => p.component === componentName).length;
    const title = count > 0 ? `${defaultTitle} (${count + 1})` : defaultTitle;
    const refPanel = api.panels.find((p) => p.component === componentName) || api.panels[0];
    api.addPanel({
      id: `${componentName}-${Date.now()}`,
      component: componentName,
      title,
      position: refPanel ? { direction: 'within', referencePanel: refPanel } : undefined,
    });
  }, []);
 
  const popoutActivePanel = useCallback(() => {
    const api = dockApiRef.current;
    if (!api) return;
    const panel = api.activePanel || api.panels[0];
    if (panel) {
      api.addPopoutGroup(panel.group);
    }
  }, []);
 
  const floatActivePanel = useCallback(() => {
    const api = dockApiRef.current;
    if (!api) return;
    const panel = api.activePanel || api.panels[0];
    if (panel) {
      api.addFloatingGroup(panel.group);
    }
  }, []);
 
  // Global hotkeys for Popout (Alt+P) and Float (Alt+F)
  useEffect(() => {
    const handleKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) {
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        popoutActivePanel();
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        floatActivePanel();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [popoutActivePanel, floatActivePanel]);
 
  /** Focus an existing dock panel by id, or add it as a new tab next to
   *  the dopesheet if it doesn't exist yet. Pass { onlyIfOpen: true } for
   *  callers that want to activate the tab only when it's already present
   *  (e.g. selecting a keyframe shouldn't force-open the Curves tab for
   *  someone who closed it — it should just switch to it if it's there). */
  const focusDockPanel = useCallback((panelId, opts) => {
    const api = dockApiRef.current;
    if (!api) return;
    const existing = api.getPanel(panelId);
    if (existing) {
      existing.api.setActive();
    } else if (!opts?.onlyIfOpen) {
      // Add new tab next to dopesheet (or timeline if dopesheet missing)
      const refPanel = api.getPanel('dopesheet') || api.getPanel('timeline');
      if (refPanel) {
        api.addPanel({
          id: panelId,
          component: panelId,
          title: panelId === 'curveEditor' ? 'Curves' : panelId,
          position: { direction: 'within', referencePanel: refPanel },
        });
      }
    }
  }, []);
 
  return {
    setDockApi,
    setResetLayout,
    handleResetLayout,
    openOrFocusPanel,
    addNewPanelInstance,
    popoutActivePanel,
    floatActivePanel,
    focusDockPanel,
  };
}