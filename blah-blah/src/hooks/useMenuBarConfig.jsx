import { useMemo } from 'react';
import {
  FilePlus, FolderOpen, Save, Download, Undo2, Redo2, Scissors, Trash2,
  Code, MousePointer2, Settings, Sliders, PlaySquare, Clock, Layers,
  Activity, Copy, ExternalLink, Maximize2, RotateCcw, BookOpen,
} from 'lucide-react';
import { isTauri } from '../services/tauriFsAdapter';
import { openProjectInExplorer, openProjectInVsCode, openProjectInCursor } from '../services/ideLauncher';
 
/**
 * useMenuBarConfig — Unity-style top menu (File/Edit/View/Window) config.
 *
 * Pure data construction: builds the array MenuBar renders, with no state
 * of its own. Add new menus by appending to the returned array; MenuBar
 * renders them automatically. Each item can have: label, shortcut, icon,
 * onClick, disabled, danger. Use { type: 'separator' } for dividers.
 *
 * Everything this needs (undo/redo, save handlers, panel handlers, modal
 * openers, prefab-mode branching) is owned by other hooks/state in
 * App.jsx, so it's all injected as params — this hook only assembles them
 * into the menu shape MenuBar expects.
 */
export function useMenuBarConfig({
  keybinds,
  isPrefabMode,
  selectedEntityId,
  projectFolderHandle,
  canUndo,
  canRedo,
  undo,
  redo,
  handleSplitEntity,
  handleDeleteEntity,
  prefabEntityActions,
  handleOpenProjectFolder,
  handleSaveProjectToDisk,
  handleSaveCurrentPrefab,
  handleOpenSilenceRemover,
  openOrFocusPanel,
  addNewPanelInstance,
  popoutActivePanel,
  floatActivePanel,
  handleResetLayout,
  setIsNewProjectOpen,
  setIsExportOpen,
  setIsProjectJsonOpen,
  setIsScriptDocsOpen,
  setIsSettingsOpen,
}) {
  return useMemo(() => [
    {
      label: 'File',
      items: [
        { label: 'New Project', shortcut: 'Ctrl+N', icon: <FilePlus size={13} />, onClick: () => setIsNewProjectOpen(true) },
        { label: 'Open Project...', shortcut: 'Ctrl+O', icon: <FolderOpen size={13} />, onClick: handleOpenProjectFolder },
        { label: isPrefabMode ? 'Save Prefab' : 'Save Project', shortcut: keybinds.saveProject, icon: <Save size={13} />, onClick: isPrefabMode ? handleSaveCurrentPrefab : handleSaveProjectToDisk, disabled: isPrefabMode ? false : !projectFolderHandle },
        { type: 'separator' },
        { label: 'Export Render...', shortcut: 'Ctrl+E', icon: <Download size={13} />, onClick: () => setIsExportOpen(true) },
        { type: 'separator' },
        { label: 'Open in VS Code', icon: <Code size={13} />, onClick: () => openProjectInVsCode(projectFolderHandle?.path), disabled: !isTauri() || !projectFolderHandle?.path },
        { label: 'Open in Cursor', icon: <MousePointer2 size={13} />, onClick: () => openProjectInCursor(projectFolderHandle?.path), disabled: !isTauri() || !projectFolderHandle?.path },
        { label: 'Show in Explorer', icon: <FolderOpen size={13} />, onClick: () => openProjectInExplorer(projectFolderHandle?.path), disabled: !isTauri() || !projectFolderHandle?.path },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: keybinds.undo, icon: <Undo2 size={13} />, onClick: undo, disabled: !canUndo },
        { label: 'Redo', shortcut: keybinds.redo, icon: <Redo2 size={13} />, onClick: redo, disabled: !canRedo },
        { type: 'separator' },
        { label: 'Split Clip (Cut)', shortcut: keybinds.splitSelected, icon: <Scissors size={13} />, onClick: () => selectedEntityId && (isPrefabMode ? prefabEntityActions.handleSplitEntity(selectedEntityId) : handleSplitEntity(selectedEntityId)), disabled: !selectedEntityId },
        { label: 'Cut Silence...', icon: <Scissors size={13} />, onClick: () => handleOpenSilenceRemover(selectedEntityId), disabled: !selectedEntityId },
        { label: 'Delete Clip', shortcut: keybinds.deleteSelected, icon: <Trash2 size={13} />, onClick: () => selectedEntityId && (isPrefabMode ? prefabEntityActions.handleDeleteEntity(selectedEntityId) : handleDeleteEntity(selectedEntityId)), disabled: !selectedEntityId, danger: true },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Project Code', icon: <Code size={13} />, onClick: () => setIsProjectJsonOpen(true) },
        { label: 'Script API Docs', icon: <BookOpen size={13} />, onClick: () => setIsScriptDocsOpen(true) },
        { type: 'separator' },
        { label: 'Settings', icon: <Settings size={13} />, onClick: () => setIsSettingsOpen(true) },
      ],
    },
    {
      label: 'Window',
      items: [
        { label: 'Inspector', icon: <Sliders size={13} />, onClick: () => openOrFocusPanel('inspector', 'Inspector') },
        { label: 'Preview', icon: <PlaySquare size={13} />, onClick: () => openOrFocusPanel('preview', 'Preview') },
        { label: 'Project', icon: <FolderOpen size={13} />, onClick: () => openOrFocusPanel('project', 'Project') },
        { label: 'Timeline', icon: <Clock size={13} />, onClick: () => openOrFocusPanel('timeline', 'Timeline') },
        { label: 'Dopesheet', icon: <Layers size={13} />, onClick: () => openOrFocusPanel('dopesheet', 'Dopesheet') },
        { label: 'Curves', icon: <Activity size={13} />, onClick: () => openOrFocusPanel('curveEditor', 'Curves') },
        { label: 'Silence Remover', icon: <Scissors size={13} />, onClick: () => openOrFocusPanel('silenceRemover', 'Silence Remover') },
        { type: 'separator' },
        { label: 'New Inspector Tab', icon: <Copy size={13} />, onClick: () => addNewPanelInstance('inspector', 'Inspector') },
        { label: 'New Preview Tab', icon: <Copy size={13} />, onClick: () => addNewPanelInstance('preview', 'Preview') },
        { type: 'separator' },
        { label: 'Popout Active Window', shortcut: 'Alt+P', icon: <ExternalLink size={13} />, onClick: popoutActivePanel },
        { label: 'Float Active Window', shortcut: 'Alt+F', icon: <Maximize2 size={13} />, onClick: floatActivePanel },
        { type: 'separator' },
        { label: 'Reset Layout', icon: <RotateCcw size={13} />, onClick: handleResetLayout },
      ],
    },
  ], [
    canUndo, canRedo, undo, redo, selectedEntityId, keybinds,
    handleSplitEntity, handleOpenSilenceRemover, handleDeleteEntity, prefabEntityActions, handleOpenProjectFolder,
    handleSaveProjectToDisk, handleSaveCurrentPrefab,
    projectFolderHandle, isPrefabMode,
    openOrFocusPanel, addNewPanelInstance, popoutActivePanel, floatActivePanel, handleResetLayout,
    setIsNewProjectOpen, setIsExportOpen, setIsProjectJsonOpen, setIsScriptDocsOpen, setIsSettingsOpen,
  ]);
}