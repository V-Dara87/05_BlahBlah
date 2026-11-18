import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeInViewport } from '../../utils/viewportPlacement';
import './context-menu.css';

const VIEWPORT_MARGIN = 6;
 
/**
 * ContextMenu — shared shell for every right-click menu in the app
 * (Project panel, Timeline clips, and any future one).
 *
 * Centralizes what used to be re-implemented per menu:
 *  - ANY menu, however long, stays fully reachable: it is pushed back inside
 *    the window near an edge, and when it is taller than the window it is
 *    capped to the window height and scrolls inside itself (see
 *    utils/viewportPlacement.js). Every right-click menu must go through this
 *    shell so that holds app-wide; do not hand-roll a `position: fixed` menu.
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
// Keep menu interactions from reaching the component tree that rendered the
// menu (see the note on the root element below).
const stopBubble = (e) => e.stopPropagation();
 
export function ContextMenu({ x, y, onClose, children, className = '', minWidth = 160 }) {
  const menuRef = useRef(null);
  const [coords, setCoords] = useState(null);
  // True when the menu is taller than the window: it then scrolls inside itself.
  const [scrollable, setScrollable] = useState(false);
  // 'entering' -> 'open' (next frame, so the enter transition actually
  // runs instead of the element appearing already at its final state) ->
  // 'closing' (set by requestClose, then unmounts after the transition).
  const [phase, setPhase] = useState('entering');
 
  const requestClose = () => {
    setPhase((p) => (p === 'closing' ? p : 'closing'));
  };
 
  // Place the menu inside the viewport once its real size is known: open at
  // the click point, push back inside near an edge, and when it is taller than
  // the window cap it (max-height) and let it scroll. offsetWidth / scrollHeight
  // are used because, unlike getBoundingClientRect, they ignore the open/close
  // scale transform.
  const place = useCallback(() => {
    const el = menuRef.current;
    if (!el) return;
    const next = placeInViewport({
      x,
      y,
      width: el.offsetWidth,
      height: el.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      margin: VIEWPORT_MARGIN,
    });
    setCoords((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : { left: next.left, top: next.top }));
    setScrollable(next.scrollable);
  }, [x, y]);

  useLayoutEffect(() => {
    place();
    // Flip to 'open' on the next frame so the CSS transition (opacity +
    // transform) animates from the 'entering' state instead of snapping
    // straight to final values.
    const raf = requestAnimationFrame(() => setPhase((p) => (p === 'entering' ? 'open' : p)));
    return () => cancelAnimationFrame(raf);
  }, [place]);

  // Keep it inside the window when the window is resized or the menu's own
  // content changes size (items appearing, a submenu opening, fonts loading).
  useEffect(() => {
    const el = menuRef.current;
    window.addEventListener('resize', place);
    let ro = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(place);
      ro.observe(el);
    }
    return () => {
      window.removeEventListener('resize', place);
      if (ro) ro.disconnect();
    };
  }, [place]);
 
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
        maxHeight: Math.max(120, window.innerHeight - VIEWPORT_MARGIN * 2),
        // Only when it has to: an always-on overflow would clip menus that
        // draw a submenu outside their own box.
        overflowY: scrollable ? 'auto' : undefined,
        overscrollBehavior: 'contain',
        visibility: coords ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
      // The menu is portaled to document.body, but React still bubbles
      // synthetic events through the REACT tree — i.e. up into whatever
      // component rendered the menu (a clip, a track header, the timeline
      // lanes...). Without this, pressing a menu item counted as a click on
      // the timeline behind it: the lasso handler treated it as "click on
      // empty lane space", moved the playhead there and cleared the
      // selection. Stop pointer/mouse/click events at the menu boundary.
      // (Outside-click-to-close uses a native document listener, so it is
      // unaffected; the buttons' own onClick handlers run before this.)
      onPointerDown={stopBubble}
      onPointerUp={stopBubble}
      onMouseDown={stopBubble}
      onMouseUp={stopBubble}
      onClick={stopBubble}
      onDoubleClick={stopBubble}
    >
      {children}
    </div>,
    document.body
  );
}