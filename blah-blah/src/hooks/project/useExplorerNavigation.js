import { useState, useCallback } from 'react';
import { isSameLocation } from '../../components/project/projectPanelConstants';
 
/**
 * Owns the Explorer's current location + back/forward history stack,
 * mirroring a Windows File Explorer address bar.
 *
 * @param {object} params
 * @param {{section:string|null, folder:string|null}} params.rootLocation
 * @param {() => void} params.clearSelection - called whenever navigation changes location
 */
export function useExplorerNavigation({ rootLocation, clearSelection }) {
  const [currentLocation, setCurrentLocation] = useState(rootLocation);
  const [history, setHistory] = useState([rootLocation]);
  const [historyIndex, setHistoryIndex] = useState(0);
 
  const navigateTo = useCallback((newLoc) => {
    setCurrentLocation((prev) => {
      if (isSameLocation(prev, newLoc)) return prev;
      setHistory((prevHist) => {
        const sliced = prevHist.slice(0, historyIndex + 1);
        return [...sliced, newLoc];
      });
      setHistoryIndex((prevIdx) => prevIdx + 1);
      return newLoc;
    });
    clearSelection();
  }, [historyIndex, clearSelection]);
 
  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1;
      setHistoryIndex(nextIdx);
      setCurrentLocation(history[nextIdx]);
      clearSelection();
    }
  }, [historyIndex, history, clearSelection]);
 
  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      setHistoryIndex(nextIdx);
      setCurrentLocation(history[nextIdx]);
      clearSelection();
    }
  }, [historyIndex, history, clearSelection]);
 
  const goUp = useCallback(() => {
    if (currentLocation.folder) {
      navigateTo({ section: currentLocation.section, folder: null });
    } else if (currentLocation.section) {
      navigateTo(rootLocation);
    }
  }, [currentLocation, navigateTo, rootLocation]);
 
  // Used when a folder the user is currently inside gets renamed elsewhere
  // (e.g. by file-ops); updates the location in place without touching history.
  const renameCurrentFolderIfActive = useCallback((section, oldName, newName) => {
    setCurrentLocation((prev) =>
      prev.section === section && prev.folder === oldName
        ? { ...prev, folder: newName }
        : prev
    );
  }, []);
 
  return {
    currentLocation,
    history,
    historyIndex,
    navigateTo,
    goBack,
    goForward,
    goUp,
    renameCurrentFolderIfActive,
  };
}