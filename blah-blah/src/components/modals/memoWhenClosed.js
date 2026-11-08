import { memo } from 'react';

/**
 * Props comparator for always-mounted modals.
 *
 * App keeps its modals mounted while closed (some rely on that to hold state
 * across open/close), so every App render used to re-render them too. When a
 * modal is closed both before and after an update there is nothing visible to
 * update, so skip the render. Any update that involves an open modal (opening,
 * closing, or already open) falls back to a plain shallow prop comparison, so
 * open/close effects and state resets still run exactly as before. State the
 * modal owns itself (downloads, exports in progress, ...) is unaffected:
 * memo() never blocks a component's own setState or context updates.
 */
export function areModalPropsEqual(prev, next) {
  if (!prev.isOpen && !next.isOpen) return true;
  const prevKeys = Object.keys(prev);
  if (prevKeys.length !== Object.keys(next).length) return false;
  for (const key of prevKeys) {
    if (!Object.is(prev[key], next[key])) return false;
  }
  return true;
}

export function memoWhenClosed(Component) {
  return memo(Component, areModalPropsEqual);
}