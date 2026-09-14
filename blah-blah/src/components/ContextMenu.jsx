import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * ContextMenu — shared shell for every right-click menu in the app
 * (Project panel, Timeline clips, and any future one).
 *
 * Centralizes what used to be re-implemented per menu:
 *  - portal to document.body + `fixed` positioning clamped inside the
 *    viewport (same approach as FontFamilyPicker's popover), so a menu
 *    opened near a panel edge never gets cut off or overlaps outside the
 *    window
 *  - outside-click / Escape-to-close, with a `data-context-menu` marker so
 *    nested content (submenus, inputs) doesn't false-trigger a close
 *  - a quick fade + slight scale/slide open animation, and a matching
 *    closing transition instead of the old instant-appear/instant-vanish
 *    raw popup — this needs its own open/closing state because the portal
 *    node has to stay mounted for the closing transition to actually play
 *
 * Usage: render `{ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y}
 * onClose={closeCtxMenu}>{...menu items...}</ContextMenu>}` — same
 * x/y/onClose contract every existing menu already tracked in its own
 * state, so callers keep their own item logic and only swap the outer
 * shell.
 */
export function ContextMenu({ x, y, onClose, children, className = '', minWidth = 160 }) {
  const menuRef = useRef(null);
  const [coords, setCoords] = useState(null);
  // 'entering' -> 'open' (next frame, so the enter transition actually
  // runs instead of the element appearing already at its final state) ->
  // 'closing' (set by requestClose, then unmounts after the transition).
  const [phase, setPhase] = useState('entering');

  const requestClose = () => {
    setPhase((p) => (p === 'closing' ? p : 'closing'));
  };

  // Clamp the requested (x, y) inside the viewport once the menu's real
  // size is known, same idea as the font picker popover: prefer opening
  // at the click point, flip up/left near an edge rather than spilling
  // off-screen or getting clipped by an ancestor's overflow.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 6;
    let left = x;
    let top = y;
    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setCoords({ left, top });
    // Flip to 'open' on the next frame so the CSS transition (opacity +
    // transform) animates from the 'entering' state instead of snapping
    // straight to final values.
    const raf = requestAnimationFrame(() => setPhase((p) => (p === 'entering' ? 'open' : p)));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      requestClose();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') requestClose();
    };
    // Capture phase: a right-click elsewhere fires its own 'contextmenu'
    // handler to open a *different* menu — that handler runs before this
    // pointerdown listener would in bubble phase, which could race two
    // menus open at once. Capture phase closes this one first.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Once the closing transition has had time to play, tell the caller to
  // actually unmount us (they own the `ctxMenu` state this reads from).
  useEffect(() => {
    if (phase !== 'closing') return undefined;
    const t = setTimeout(() => onClose?.(), 120);
    return () => clearTimeout(t);
  }, [phase, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      data-context-menu
      className={`context-menu-shell ${className} context-menu-${phase === 'open' ? 'open' : 'closed'}`}
      style={{
        left: coords?.left ?? x,
        top: coords?.top ?? y,
        minWidth,
        visibility: coords ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body
  );
}