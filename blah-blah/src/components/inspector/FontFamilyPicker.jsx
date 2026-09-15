/**
 * FontFamilyPicker — searchable family select for the Text Component.
 *
 * Merges the curated FALLBACK_FONT_FAMILIES list with whatever
 * queryInstalledFontFamilies() can see (Local Font Access API, best-effort).
 * The OS query only runs when the popover opens, so we never prompt for
 * permission until the user actually wants a PC font.
 *
 * INDEPENDENT POPOVER: the list previously rendered as a plain absolutely-
 * positioned child of the trigger, which meant it was clipped to whatever
 * the Inspector panel/dock column happened to allow (fixed narrow width,
 * cut off by the panel's own overflow/scroll). It's now rendered through a
 * portal straight onto document.body and positioned with `fixed` using the
 * trigger's live bounding rect, so it floats free of the Inspector's width
 * and scroll clipping — a real popover, not a boxed-in dropdown. Position
 * is recalculated on open, and again on scroll/resize while open so it
 * tracks the trigger if the Inspector panel scrolls underneath it.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FALLBACK_FONT_FAMILIES, queryInstalledFontFamilies } from '../../utils/systemFonts';
import { SearchBar } from './SearchBar';
import './font-family-picker.css';

const POPOVER_WIDTH = 260;
const POPOVER_MAX_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;

export function FontFamilyPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [installed, setInstalled] = useState([]);
  const [coords, setCoords] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const current = value || 'Inter';

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    queryInstalledFontFamilies().then((list) => {
      if (!cancelled) setInstalled(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Recompute the popover's screen position from the trigger's live
  // bounding rect. Prefers opening below the trigger; flips above when
  // there isn't enough room underneath, and always stays clamped inside
  // the viewport horizontally so it can't run off-screen on a narrow
  // Inspector docked near the window edge.
  const updateCoords = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpward = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(POPOVER_MAX_HEIGHT, (openUpward ? spaceAbove : spaceBelow) - VIEWPORT_MARGIN));

    let left = rect.left;
    const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN;
    if (left > maxLeft) left = Math.max(VIEWPORT_MARGIN, maxLeft);

    setCoords({
      left,
      top: openUpward ? undefined : rect.bottom + 4,
      bottom: openUpward ? window.innerHeight - rect.top + 4 : undefined,
      width: Math.max(rect.width, POPOVER_WIDTH),
      maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    updateCoords();
    const onReposition = () => updateCoords();
    // Capture-phase scroll listener so this tracks scrolling inside any
    // ancestor (the Inspector dock panel's own scroll container), not just
    // the window.
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const families = useMemo(() => {
    const set = new Set([...FALLBACK_FONT_FAMILIES, ...installed]);
    if (current) set.add(current);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [installed, current]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return families;
    return families.filter((f) => f.toLowerCase().includes(q));
  }, [families, query]);

  const pick = (family) => {
    onChange(family);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="font-family-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="inspector-select font-family-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        title="Font family"
        style={{ fontFamily: current, textAlign: 'left', width: '100%', cursor: 'pointer' }}
      >
        {current}
      </button>
      {open && coords && createPortal(
        <div
          ref={popoverRef}
          className="font-family-picker-popover font-family-picker-popover-portal"
          style={{
            position: 'fixed',
            left: coords.left,
            top: coords.top,
            bottom: coords.bottom,
            width: coords.width,
          }}
        >
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search fonts…"
            autoFocus
          />
          <div className="font-family-picker-list" style={{ maxHeight: coords.maxHeight }}>
            {filtered.length === 0 && (
              <div className="font-family-picker-empty">No matching fonts</div>
            )}
            {filtered.map((family) => (
              <button
                key={family}
                type="button"
                className={`font-family-picker-item${family === current ? ' active' : ''}`}
                style={{ fontFamily: family }}
                onClick={() => pick(family)}
              >
                {family}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}