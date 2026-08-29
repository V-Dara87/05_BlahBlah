import { useRef, useState, useEffect, useCallback } from 'react';

/**
 * DragNumber – Unity-style drag-to-scrub number input.
 * Click-drag left/right on the label to change the value.
 * Click once to switch to a text input for precise typing.
 */
export function DragNumber({
  label,
  value,
  onChange,
  step = 0.1,
  min = -Infinity,
  max = Infinity,
  labelColor = null,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const isDragging = useRef(false);
  const hasDragged = useRef(false);
  const startX = useRef(0);
  const startVal = useRef(0);

  // Keep latest values in ref via useEffect (safe for React lifecycle)
  const propsRef = useRef({ min, max, step, onChange, value, isEditing });
  useEffect(() => {
    propsRef.current = { min, max, step, onChange, value, isEditing };
  }, [min, max, step, onChange, value, isEditing]);

  const handlePointerDown = useCallback((e) => {
    if (propsRef.current.isEditing) return;
    isDragging.current = true;
    hasDragged.current = false;
    startX.current = e.clientX;
    const v = propsRef.current.value;
    startVal.current = typeof v === 'number' ? v : parseFloat(v) || 0;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e) => {
    if (!isDragging.current) return;
    const { min: lo, max: hi, step: s, onChange: cb } = propsRef.current;
    const delta = e.clientX - startX.current;
    if (Math.abs(delta) > 2) hasDragged.current = true;
    const raw = startVal.current + delta * s;
    const clamped = Math.min(hi, Math.max(lo, raw));
    cb(parseFloat(clamped.toFixed(4)));
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (!hasDragged.current) {
      setEditValue(String(propsRef.current.value));
      setIsEditing(true);
    }
  }, []);

  const handleEditBlur = () => {
    const { min: lo, max: hi, onChange: cb } = propsRef.current;
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed)) {
      const clamped = Math.min(hi, Math.max(lo, parsed));
      cb(parseFloat(clamped.toFixed(4)));
    }
    setIsEditing(false);
  };

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') e.target.blur();
    if (e.key === 'Escape') setIsEditing(false);
  };

  const displayValue = typeof value === 'number'
    ? (Number.isInteger(value) ? value : parseFloat(value.toFixed(3)))
    : value;

  return (
    <div className="drag-number-field">
      <span
        className="drag-number-label"
        style={labelColor ? { color: labelColor } : {}}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title="Drag ← → to adjust · Click to type"
      >
        {label}
      </span>

      {isEditing ? (
        <input
          className="drag-number-input editing"
          type="text"
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleEditBlur}
          onKeyDown={handleEditKeyDown}
        />
      ) : (
        <div
          className="drag-number-value"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          title="Drag ← → to adjust · Click to type"
        >
          {displayValue}
        </div>
      )}
    </div>
  );
}
