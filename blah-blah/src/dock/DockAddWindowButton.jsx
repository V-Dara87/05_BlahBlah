import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Sliders,
  PlaySquare,
  FolderOpen,
  Clock,
  Layers,
  Activity,
  Scissors,
  Volume2,
  Terminal,
  Check,
  Copy,
} from 'lucide-react';
import {
  AVAILABLE_DOCK_WINDOWS,
  openOrAddWindowToGroup,
  addNewWindowInstanceToGroup,
} from './dockWindows';

const ICON_MAP = {
  FolderOpen,
  PlaySquare,
  Sliders,
  Clock,
  Layers,
  Activity,
  Scissors,
  Volume2,
  Terminal,
};

/**
 * DockAddWindowButton
 *
 * Renders an "Add Window" button (`+`) with a dropdown menu.
 * Used in:
 * - `DockLeftHeaderActions` (`variant="tab"`, rendered right after tabs on the tab bar)
 * - `DockHeaderActions` (`variant="header"`, rendered on the right layout actions bar)
 */
export const DockAddWindowButton = memo(function DockAddWindowButton({
  containerApi,
  group,
  variant = 'header', // 'header' | 'tab'
  title = 'Add window to this layout',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const handleToggle = useCallback((e) => {
    e.stopPropagation();
    setIsOpen((prev) => {
      if (!prev && btnRef.current) {
        const rect = btnRef.current.getBoundingClientRect();
        const doc = btnRef.current.ownerDocument || document;
        const docWidth = doc.documentElement?.clientWidth || window.innerWidth;
        const docHeight = doc.documentElement?.clientHeight || window.innerHeight;
        const menuWidth = 250;
        const menuHeight = 350;

        let left = rect.left;
        if (left + menuWidth > docWidth - 8) {
          left = Math.max(8, rect.right - menuWidth);
        }
        let top = rect.bottom + 4;
        if (top + menuHeight > docHeight - 8 && rect.top > menuHeight) {
          top = Math.max(8, rect.top - menuHeight - 4);
        }
        setMenuPos({ top, left });
      }
      return !prev;
    });
  }, []);

  // Dismiss listeners: outside click, escape key, resize, scroll
  useEffect(() => {
    if (!isOpen) return;
    const doc = btnRef.current?.ownerDocument || document;

    const handlePointerDown = (e) => {
      if (
        btnRef.current?.contains(e.target) ||
        menuRef.current?.contains(e.target)
      ) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleDismiss = () => setIsOpen(false);

    doc.addEventListener('pointerdown', handlePointerDown, true);
    doc.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleDismiss);
    window.addEventListener('scroll', handleDismiss, true);

    return () => {
      doc.removeEventListener('pointerdown', handlePointerDown, true);
      doc.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('scroll', handleDismiss, true);
    };
  }, [isOpen]);

  const handleSelect = useCallback((win) => {
    openOrAddWindowToGroup({ win, containerApi, group });
    setIsOpen(false);
  }, [containerApi, group]);

  const handleAddInstance = useCallback((e, win) => {
    e.stopPropagation();
    addNewWindowInstanceToGroup({ win, containerApi, group });
    setIsOpen(false);
  }, [containerApi, group]);

  const isTabVariant = variant === 'tab';
  const buttonClass = isTabVariant
    ? `dock-tab-add-btn ${isOpen ? 'is-open' : ''}`
    : `dock-action-btn dock-add-btn ${isOpen ? 'is-open' : ''}`;

  const portalTarget =
    btnRef.current?.ownerDocument?.body ||
    (typeof document !== 'undefined' ? document.body : null);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={buttonClass}
        onClick={handleToggle}
        title={title}
        aria-label={title}
        aria-expanded={isOpen}
      >
        <Plus size={isTabVariant ? 11 : 12} strokeWidth={isTabVariant ? 2.5 : 2} />
      </button>

      {isOpen && portalTarget && createPortal(
        <div
          ref={menuRef}
          className="dock-add-window-dropdown"
          style={{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="dock-add-window-header">
            <span className="dock-add-window-title">Add Window</span>
            <span className="dock-add-window-subtitle">to this tab group</span>
          </div>
          <div className="dock-add-window-list">
            {AVAILABLE_DOCK_WINDOWS.map((win) => {
              const Icon = ICON_MAP[win.iconName] || Plus;
              const inThisGroup = (containerApi?.panels || []).some(
                (p) => p.component === win.component && (p.group?.id === group?.id || p.group === group)
              );
              const openElsewhere =
                !inThisGroup &&
                (containerApi?.panels || []).some((p) => p.component === win.component);

              return (
                <div
                  key={win.id}
                  className={`dock-add-window-item ${inThisGroup ? 'is-active-tab' : ''}`}
                  onClick={() => handleSelect(win)}
                  title={
                    inThisGroup
                      ? `${win.title} is already active in this tab group`
                      : openElsewhere
                      ? `Move ${win.title} to this group`
                      : `Open ${win.title} in this group`
                  }
                >
                  <span className="dock-add-window-item-icon">
                    <Icon size={13} />
                  </span>
                  <div className="dock-add-window-item-info">
                    <span className="dock-add-window-item-name">{win.title}</span>
                    <span className="dock-add-window-item-desc">{win.desc}</span>
                  </div>
                  <div className="dock-add-window-item-actions">
                    {inThisGroup ? (
                      <span className="dock-add-window-badge in-group">
                        <Check size={10} /> Active
                      </span>
                    ) : openElsewhere ? (
                      <span className="dock-add-window-badge elsewhere">Move here</span>
                    ) : (
                      <span className="dock-add-window-badge add">+ Add</span>
                    )}
                    <button
                      type="button"
                      className="dock-add-window-instance-btn"
                      onClick={(e) => handleAddInstance(e, win)}
                      title={`Open another instance of ${win.title} as a new tab`}
                      aria-label={`Open another instance of ${win.title}`}
                    >
                      <Copy size={10} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>,
        portalTarget
      )}
    </>
  );
});
