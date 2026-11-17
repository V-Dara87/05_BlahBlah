import {
  Plus,
  Sliders,
  PlaySquare,
  FolderOpen,
  Clock,
  Layers,
  Activity,
  Scissors,
  Volume2,
  Terminal,
  Package,
  MessageSquare,
} from 'lucide-react';

/**
 * iconName (see AVAILABLE_DOCK_WINDOWS in dockWindows.js) -> lucide icon.
 * Kept out of dockWindows.js so that file stays free of React/lucide imports
 * and keeps running in plain Node tests.
 */
export const DOCK_WINDOW_ICONS = {
  FolderOpen,
  PlaySquare,
  Sliders,
  Clock,
  Layers,
  Activity,
  Scissors,
  Volume2,
  Terminal,
  Package,
  MessageSquare,
};

export function getDockWindowIcon(iconName) {
  return DOCK_WINDOW_ICONS[iconName] || Plus;
}