/**
 * FontFamilyPicker — searchable family select for the Text Component.
 *
 * Merges the curated FALLBACK_FONT_FAMILIES list with whatever
 * queryInstalledFontFamilies() can see (Local Font Access API, best-effort).
 * The OS query only runs when the popover opens, so we never prompt for
 * permission until the user actually wants a PC font.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FALLBACK_FONT_FAMILIES, queryInstalledFontFamilies } from '../../utils/systemFonts';
import { SearchBar } from './SearchBar';

export function FontFamilyPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [installed, setInstalled] = useState([]);
  const rootRef = useRef(null);
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

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
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
        type="button"
        className="inspector-select font-family-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        title="Font family"
        style={{ fontFamily: current, textAlign: 'left', width: '100%', cursor: 'pointer' }}
      >
        {current}
      </button>
      {open && (
        <div className="font-family-picker-popover">
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search fonts…"
            autoFocus
          />
          <div className="font-family-picker-list">
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
        </div>
      )}
    </div>
  );
}
