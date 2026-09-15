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