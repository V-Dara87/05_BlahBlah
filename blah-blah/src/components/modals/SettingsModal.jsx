import { useState, useMemo, useEffect } from 'react';
import { Settings, X, Search, Globe, FolderOpen } from 'lucide-react';
import {
  DEFAULT_SETTINGS_TAB_ID,
  getSettingsTab,
  groupSettingsTabs,
} from './settings/settingsTabs';
import './settings-modal.css';
 
/**
 * Settings modal shell — title bar, sidebar navigation, and footer.
 *
 * This component is deliberately generic. It does not know what any tab
 * contains: the list of tabs, their sections, order, subtitles, and the props
 * each one needs all come from ./settings/settingsTabs.js. To add or move a
 * tab, edit that file (its header comment is the how-to guide) — only touch
 * this file if a new tab needs data that App.jsx does not pass in yet.
 *
 * Every prop the modal receives is bundled into one `ctx` object and handed to
 * each tab's `getProps(ctx)`, so this signature is the single list of "what
 * Settings can see".
 */
export function SettingsModal({
  isOpen,
  onClose,
  onSettingsChanged,
  resolution,
  onResolutionChange,
  autosaveSettings,
  onAutosaveSettingsChange,
  editorSettings,
  onEditorSettingsChange,
  exportSettings,
  onExportSettingsChange,
  themeSettings,
  onThemeSettingsChange,
  pieSettings,
  onPieSettingsChange,
}) {
  const [activeTabId, setActiveTabId] = useState(DEFAULT_SETTINGS_TAB_ID);
  const [query, setQuery] = useState('');
 
  // Start from a clean sidebar every time the modal is reopened, so a stale
  // search never hides tabs the next time someone opens Settings.
  useEffect(() => {
    if (isOpen) setQuery('');
  }, [isOpen]);
 
  const groups = useMemo(() => groupSettingsTabs(query), [query]);
  const activeTab = getSettingsTab(activeTabId) || getSettingsTab(DEFAULT_SETTINGS_TAB_ID);
 
  // Searching narrows the sidebar. If that hides the tab currently on screen,
  // jump to the first match so the highlighted item and the content agree
  // (otherwise you would be reading "System" with nothing selected in the list).
  useEffect(() => {
    if (groups.length === 0) return;
    const visible = groups.some((g) => g.tabs.some((t) => t.id === activeTab.id));
    if (!visible) setActiveTabId(groups[0].tabs[0].id);
  }, [groups, activeTab.id]);
 
  if (!isOpen) return null;
 
  const ctx = {
    onSettingsChanged,
    resolution,
    onResolutionChange,
    autosaveSettings,
    onAutosaveSettingsChange,
    editorSettings,
    onEditorSettingsChange,
    exportSettings,
    onExportSettingsChange,
    themeSettings,
    onThemeSettingsChange,
    pieSettings,
    onPieSettingsChange,
  };
 
  const ActiveComponent = activeTab.Component;
  const isProjectScope = activeTab.scope === 'project';
 
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge">
              <Settings size={18} className="text-cyan" />
            </div>
            <div>
              <h3>Settings</h3>
              <p className="modal-subtitle">{activeTab.subtitle}</p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close settings">
            <X size={16} />
          </button>
        </div>
 
        <div className="settings-layout">
          <nav className="settings-sidebar" aria-label="Settings sections">
            <div className="settings-search">
              <Search size={12} className="settings-search-icon" />
              <input
                type="text"
                className="settings-search-input"
                placeholder="Search settings"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search settings"
              />
            </div>
 
            <div className="settings-nav-scroll">
              {groups.length === 0 && (
                <p className="settings-nav-empty">No settings match “{query.trim()}”.</p>
              )}
 
              {groups.map(({ section, tabs }) => (
                <div className="settings-nav-section" key={section.id}>
                  <div className="settings-nav-heading">{section.label}</div>
                  {tabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        className={`settings-nav-item ${activeTab.id === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTabId(tab.id)}
                        aria-current={activeTab.id === tab.id ? 'page' : undefined}
                      >
                        <Icon size={13} />
                        <span className="settings-nav-label">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </nav>
 
          <div className="settings-content">
            <div className="settings-content-header">
              <h4 className="settings-content-title">{activeTab.label}</h4>
              <span
                className={`settings-scope-badge ${isProjectScope ? 'project' : 'global'}`}
                title={
                  isProjectScope
                    ? 'Saved inside this project and applies only to it.'
                    : 'Saved on this computer and applies to every project.'
                }
              >
                {isProjectScope ? <FolderOpen size={10} /> : <Globe size={10} />}
                {isProjectScope ? 'This project' : 'Global'}
              </span>
            </div>
 
            <div className="settings-content-body">
              <ActiveComponent key={activeTab.id} {...activeTab.getProps(ctx)} />
            </div>
          </div>
        </div>
 
        <div className="modal-footer settings-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}