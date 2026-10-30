/**
 * Utilities for project.json revision hashing and concurrent edit conflict resolution.
 * Shared between editor runtime and standalone Node test suites.
 */

/**
 * Computes a hexadecimal SHA-1 hash for `text`, identical to Node's
 * `crypto.createHash('sha1').update(text).digest('hex')` used in `blahblah-core`.
 * Uses Web Crypto (`crypto.subtle`) when available, falling back to Node `crypto`.
 *
 * @param {string} text
 * @returns {Promise<string>} 40-character hex SHA-1 digest
 */
export async function computeTextHash(text) {
  if (typeof text !== 'string') text = String(text ?? '');
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  try {
    const { createHash } = await import('node:crypto');
    return createHash('sha1').update(text).digest('hex');
  } catch {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(16).padStart(40, '0');
  }
}

/**
 * Thrown when an autosave or save attempt detects that project.json has been
 * modified on disk by an external process (CLI, MCP, VS Code) since it was
 * loaded or last saved.
 */
export class ProjectConflictError extends Error {
  constructor(message = 'project.json changed on disk while it was being edited.') {
    super(message);
    this.name = 'ProjectConflictError';
    this.code = 'EPROJECT_CONFLICT';
  }
}

/**
 * Checks if disk text differs from the recorded revision hash.
 *
 * @param {object} params
 * @param {string|null} params.currentRevision - The revision hash known to memory
 * @param {string} params.diskText - Current raw text read from disk
 * @returns {Promise<boolean>} true if disk differs from recorded revision
 */
export async function checkRevisionConflict({ currentRevision, diskText }) {
  if (!currentRevision || typeof diskText !== 'string') return false;
  const diskHash = await computeTextHash(diskText);
  return diskHash !== currentRevision;
}

/**
 * Pure policy deciding how to handle an external change notification.
 *
 * @param {object} params
 * @param {'saved'|'saving'|'unsaved'|'in-memory'} params.saveStatus
 * @param {boolean} params.hasConflict
 * @returns {'reload'|'prompt'|'ignore'}
 */
export function resolveExternalChangeAction({ saveStatus, hasConflict }) {
  if (!hasConflict) return 'ignore';
  if (saveStatus === 'saved') return 'reload';
  return 'prompt';
}
