/**
 * Tiny self-removing warning banner (no React, no dependencies). Used for
 * short "that edit was refused" messages, e.g. the clip-overlap policy.
 * The same message is shown at most once per second, so a drag that is
 * refused on every frame does not stack banners.
 */
let lastMessage = '';
let lastAt = 0;

export function showNotice(message, { durationMs = 2500 } = {}) {
  if (typeof document === 'undefined') return;
  const now = Date.now();
  if (message === lastMessage && now - lastAt < 1000) return;
  lastMessage = message;
  lastAt = now;

  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: '32px',
    transform: 'translateX(-50%)',
    zIndex: '100000',
    maxWidth: '80vw',
    padding: '8px 14px',
    borderRadius: '6px',
    background: 'rgba(32, 32, 36, 0.95)',
    color: '#ffd166',
    border: '1px solid rgba(255, 209, 102, 0.5)',
    font: '12px system-ui, sans-serif',
    pointerEvents: 'none',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)',
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}