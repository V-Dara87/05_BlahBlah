import { useState, useRef, useEffect, useCallback, memo } from 'react';

/**
 * MenuBar — Unity-style top menu bar with dropdown menus.
 *
 * Usage:
 *   <MenuBar menus={[
 *     {
 *       label: 'File',
 *       items: [
 *         { label: 'New Project', shortcut: 'Ctrl+N', onClick: () => {} },
 *         { label: 'Open Project...', shortcut: 'Ctrl+O', onClick: () => {} },
 *         { type: 'separator' },
 *         { label: 'Save', shortcut: 'Ctrl+S', onClick: () => {} },
 *       ],
 *     },
 *     {
 *       label: 'Edit',
 *       items: [
 *         { label: 'Undo', shortcut: 'Ctrl+Z', onClick: () => {} },
 *         { label: 'Redo', shortcut: 'Ctrl+Shift+Z', onClick: () => {} },
 *       ],
 *     },
 *   ]} />
 *
 * Menu config shape:
 *   {
 *     label: string,           — menu button text
 *     items: Array<{
 *       type?: 'separator',   — visual divider line
 *       label?: string,       — item text (omit for separator)
 *       shortcut?: string,    — right-aligned keyboard shortcut hint
 *       icon?: ReactNode,     — optional leading icon
 *       onClick?: () => void, — click handler (omit for disabled/greyed items)
 *       disabled?: boolean,   — grey out the item
 *       danger?: boolean,     — red text (for destructive actions)
 *     }>
 *   }
 */
export const MenuBar = memo(function MenuBar({ menus = [], trailing = null }) {
  const [openIndex, setOpenIndex] = useState(null);
  const [hovering, setHovering] = useState(false);
  const barRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (openIndex === null) return;
    const handle = (e) => {
      if (barRef.current && !barRef.current.contains(e.target)) {
        setOpenIndex(null);
        setHovering(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [openIndex]);

  const handleMenuClick = useCallback((idx) => {
    setOpenIndex((prev) => (prev === idx ? null : idx));
    setHovering(true);
  }, []);

  const handleMenuEnter = useCallback((idx) => {
    if (hovering && openIndex !== null) {
      setOpenIndex(idx);
    }
  }, [hovering, openIndex]);

  const handleItemClick = useCallback((item) => {
    if (item.disabled || !item.onClick) return;
    item.onClick();
    setOpenIndex(null);
    setHovering(false);
  }, []);

  return (
    <div className="menubar" ref={barRef}>
      {menus.map((menu, idx) => (
        <div key={menu.label} className="menubar-item">
          <button
            className={`menubar-btn ${openIndex === idx ? 'active' : ''}`}
            onMouseDown={() => handleMenuClick(idx)}
            onMouseEnter={() => handleMenuEnter(idx)}
          >
            {menu.label}
          </button>
          {openIndex === idx && (
            <div className="menubar-dropdown">
              {menu.items.map((item, itemIdx) => {
                if (item.type === 'separator') {
                  return <div key={`sep-${itemIdx}`} className="menubar-separator" />;
                }
                return (
                  <button
                    key={item.label}
                    className={`menubar-dropdown-item${item.disabled ? ' disabled' : ''}${item.danger ? ' danger' : ''}`}
                    onClick={() => handleItemClick(item)}
                    disabled={item.disabled}
                  >
                    {item.icon && <span className="menubar-item-icon">{item.icon}</span>}
                    <span className="menubar-item-label">{item.label}</span>
                    {item.shortcut && (
                      <span className="menubar-item-shortcut">{item.shortcut}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
      {/* Optional right-aligned content (window controls + drag fill on
          the frameless desktop build). data-tauri-drag-region only affects
          the exact element it is on, so the menu buttons above stay fully
          interactive while the fill area below drags the window. */}
      {trailing && <div className="menubar-trailing">{trailing}</div>}
    </div>
  );
});
