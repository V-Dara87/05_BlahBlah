/**
 * Shared HTML5 drag-and-drop contract for in-app asset drags (Project
 * panel cards → timeline lanes / clip cards / Inspector, etc.).
 *
 * The payload itself travels as `application/json` with the shape
 * `{ itemType, itemData }` (itemType: 'media' | 'prefab' | 'script').
 * Browsers only expose getData() on drop, so dragstart additionally stamps
 * a custom MIME marker with the item kind — dragover handlers can inspect
 * `dataTransfer.types` (without reading payload data) to decide whether to
 * accept the drag.
 */
export const DRAG_PAYLOAD_MIME = 'application/json';

export const ITEM_KIND_MEDIA = 'media';
export const ITEM_KIND_PREFAB = 'prefab';
export const ITEM_KIND_SCRIPT = 'script';
export const ITEM_KIND_ENTITY = 'entity';

// Per-kind marker MIME. dragover handlers can only see dataTransfer.types
// (custom-type payload values are readable on drop only), so the kind goes
// in the type name itself: presence of `application/x-blahblah-item-script`
// in types means "a script drag is happening".
const kindMime = (itemType) => `application/x-blahblah-item-${itemType}`;

/**
 * Serialize an in-app asset drag onto a DataTransfer.
 * @param {DataTransfer} dataTransfer
 * @param {'media'|'prefab'|'script'} itemType
 * @param {object} itemData the full asset/prefab/script object
 */
export function setDragPayload(dataTransfer, itemType, itemData) {
  try {
    dataTransfer.setData(DRAG_PAYLOAD_MIME, JSON.stringify({ itemType, itemData }));
    dataTransfer.setData(kindMime(itemType), itemType);
    dataTransfer.effectAllowed = 'copy';
  } catch {
    // Drag payloads are best-effort; an unreadable payload just won't drop.
  }
}

/**
 * Read the payload of an in-app asset drag on drop.
 * @returns {{ itemType: string, itemData: any } | null}
 */
export function readDragPayload(dataTransfer) {
  try {
    const dataStr = dataTransfer.getData(DRAG_PAYLOAD_MIME);
    if (!dataStr) return null;
    const parsed = JSON.parse(dataStr);
    if (!parsed || !parsed.itemType) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True when an active drag carries the given item kind marker. */
export function dragHasItemKind(dataTransfer, itemType) {
  if (!dataTransfer) return false;
  const types = dataTransfer.types;
  if (!types) return false;
  const marker = kindMime(itemType);
  if (typeof types.includes === 'function') {
    return types.includes(marker);
  }
  // Legacy DOMStringList DataTransfer (rare): index scan.
  return Array.prototype.indexOf.call(types, marker) !== -1;
}
