import { Sparkles, FileCode } from 'lucide-react';
import { formatTimecode } from '../../utils/timeFormat';
 
// Shared display metadata and small pure helpers for the Project panel.
// Extracted from ProjectPanel.jsx so the panel, its cards and its hover
// previews can all read the same tables without importing each other.
 
// Per-kind display metadata for script cards (see detectScriptKind).
export const SCRIPT_KIND_META = {
  react: { icon: Sparkles, className: 'text-cyan', label: 'React Component' },
  canvas: { icon: Sparkles, className: 'text-violet', label: 'Canvas Component' },
  motion: { icon: FileCode, className: 'text-emerald', label: 'Motion Script' },
};
 
export const scriptKindMeta = (kind) => SCRIPT_KIND_META[kind] || SCRIPT_KIND_META.motion;
 
export const COMPONENT_TYPE_LABEL = {
  TextRenderer: 'Text',
  ShapeRenderer: 'Shape',
  VideoRenderer: 'Video',
  AudioSource: 'Audio',
  ScriptComponent: 'Script',
  MonoBehaviour: 'Script',
  Transform: 'Transform',
};
 
// Short display duration (drop the leading hours part like the old cards).
export const shortDuration = (sec) => formatTimecode(sec).slice(3);
 
// Sort control options (Feature 6). Duration/size are media-only keys;
// they no-op for sections whose items don't carry those fields.
export const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
];
 
export const MEDIA_SORT_OPTIONS = [
  ...SORT_OPTIONS,
  { value: 'duration-desc', label: 'Duration (longest)' },
  { value: 'size-desc', label: 'Size (largest)' },
];
 
// Composite selection key `${kind}:${id}` (Feature 1).
export const selKey = (kind, id) => `${kind}:${id}`;

export const ROOT_LOCATION = Object.freeze({ section: null, folder: null });

export const isSameLocation = (a, b) =>
  Boolean(a && b && a.section === b.section && a.folder === b.folder);

export const formatFileSize = (bytes) => {
  if (!bytes || typeof bytes !== 'number' || isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
};

export const formatDate = (timestamp) => {
  if (!timestamp) return '—';
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '—';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${mins}`;
  } catch {
    return '—';
  }
};

export const SECTIONS_CONFIG = {
  prefabs: {
    key: 'prefabs',
    dropKind: 'prefab',
    label: 'prefabs',
    title: 'Prefabs',
    colorClass: 'text-cyan',
    accentColor: '#38bdf8',
    emptyHint: 'No prefabs yet. Save a GameObject as a Prefab from the Inspector.',
    subfolderEmptyHint: 'Empty folder — save prefabs into it or drop them here.',
  },
  media: {
    key: 'media',
    dropKind: 'media',
    label: 'media',
    title: 'Media',
    colorClass: 'text-indigo',
    accentColor: '#818cf8',
    emptyHint: 'No media yet. Click + New > Import Media or drop files here.',
    subfolderEmptyHint: 'Empty folder — import media into it or drop files here.',
  },
  scripts: {
    key: 'scripts',
    dropKind: 'script',
    label: 'scripts',
    title: 'Scripts',
    colorClass: 'text-emerald',
    accentColor: '#34d399',
    emptyHint: 'No scripts yet. Click + New > Script to create one.',
    subfolderEmptyHint: 'Empty folder — create scripts into it or drop them here.',
  },
  shared: {
    key: 'shared',
    dropKind: 'shared',
    label: 'Shared Library',
    title: 'Shared Library',
    colorClass: 'text-violet',
    accentColor: '#a78bfa',
    emptyHint: 'App-wide library — share a prefab or script to keep it available across every project.',
    subfolderEmptyHint: 'Empty folder — drop shared items here.',
  },
};