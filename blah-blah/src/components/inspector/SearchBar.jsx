 
import { Search } from 'lucide-react';
 
/**
 * SearchBar.jsx — small, generic live-search input.
 *
 * Extracted from the Add Component popover's search box (previously
 * hand-written inline in UnityInspector.jsx) so any other filtered list —
 * the Font picker, future pickers — can reuse the exact same markup,
 * styling (`.search-bar-sm`), and clear-button behavior instead of each
 * re-implementing its own.
 *
 * Fully controlled: the caller owns the search string and does the actual
 * filtering (this component has no opinion on what's being searched).
 *
 * Props:
 *   value        — current search string
 *   onChange     — (newValue: string) => void
 *   placeholder  — input placeholder text
 *   autoFocus    — focus the input on mount (default true, matching the
 *                  Add Component search's prior behavior)
 *   className    — extra class(es) appended to the outer `.search-bar-sm`
 *                  wrapper, for per-usage layout tweaks (e.g. the existing
 *                  `.add-comp-search` margin override)
 */
export function SearchBar({
  value,
  onChange,
  placeholder = 'Search…',
  autoFocus = true,
  className = '',
}) {
  return (
    <div className={`search-bar-sm${className ? ` ${className}` : ''}`}>
      <Search size={11} className="search-icon" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
      />
      {value && (
        <button
          type="button"
          className="clear-search-btn"
          onClick={() => onChange('')}
          title="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );
}