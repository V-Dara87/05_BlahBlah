import fs from 'node:fs/promises';
import path from 'node:path';

export const CURRENT_SCHEMA_VERSION = 1;

export const RESOLUTION_PRESETS = {
  '1080p': { width: 1920, height: 1080, label: '1920x1080 (16:9 Landscape)' },
  '4k': { width: 3840, height: 2160, label: '3840x2160 (4K Landscape)' },
  '720p': { width: 1280, height: 720, label: '1280x720 (HD Landscape)' },
  'reels': { width: 1080, height: 1920, label: '1080x1920 (9:16 Vertical / Shorts)' },
  'square': { width: 1080, height: 1080, label: '1080x1080 (1:1 Square)' },
};

export const DEFAULT_TRACKS = [
  { id: 'track-1', name: 'Track 1', type: 'layer', muted: false, locked: false, visible: true, volume: 1.0 },
  { id: 'track-2', name: 'Track 2', type: 'layer', muted: false, locked: false, visible: true, volume: 1.0 },
  { id: 'track-3', name: 'Track 3', type: 'layer', muted: false, locked: false, visible: true, volume: 1.0 },
  { id: 'track-4', name: 'Track 4', type: 'layer', muted: false, locked: false, visible: true, volume: 1.0 },
];

/**
 * Initializes a new project folder on disk.
 */
export async function initProject({
  dir = process.cwd(),
  name = 'Untitled Project',
  resolution = '1080p',
  customResolution = null,
} = {}) {
  const projectDir = path.resolve(dir);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(path.join(projectDir, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'prefabs'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'media'), { recursive: true });

  const res = customResolution || RESOLUTION_PRESETS[resolution] || RESOLUTION_PRESETS['1080p'];
  const projectData = {
    name,
    version: '1.0',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: Date.now(),
    lastModified: Date.now(),
    resolution: { width: res.width, height: res.height },
    tracks: [...DEFAULT_TRACKS],
    entities: [],
    scriptIndex: [],
  };

  const projectFilePath = path.join(projectDir, 'project.json');
  await fs.writeFile(projectFilePath, JSON.stringify(projectData, null, 2), 'utf8');

  // Also write default jsconfig.json inside scripts/
  const jsconfig = {
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react',
      allowJs: true,
      checkJs: true,
      baseUrl: '.',
      paths: {
        '@blahblah/sdk': ['./.blahblah/sdk'],
      },
      noImplicitAny: false,
      strictNullChecks: false,
    },
    include: ['**/*', '.blahblah/**/*'],
  };
  await fs.writeFile(
    path.join(projectDir, 'scripts', 'jsconfig.json'),
    JSON.stringify(jsconfig, null, 2),
    'utf8'
  );

  return {
    projectDir,
    projectFilePath,
    project: projectData,
  };
}

/**
 * Loads project.json from a project directory.
 */
export async function loadProject(dir = process.cwd()) {
  const projectDir = path.resolve(dir);
  const projectFilePath = path.join(projectDir, 'project.json');

  try {
    const raw = await fs.readFile(projectFilePath, 'utf8');
    const project = JSON.parse(raw);
    return {
      projectDir,
      projectFilePath,
      project,
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`No project.json found at "${projectFilePath}". Run 'blahblah project init' first.`);
    }
    throw new Error(`Failed to parse project.json at "${projectFilePath}": ${err.message}`);
  }
}

/**
 * Saves project data back to project.json.
 */
export async function saveProject(dir = process.cwd(), project) {
  const projectDir = path.resolve(dir);
  const projectFilePath = path.join(projectDir, 'project.json');

  project.lastModified = Date.now();
  await fs.writeFile(projectFilePath, JSON.stringify(project, null, 2), 'utf8');
  return { projectDir, projectFilePath, project };
}

/**
 * Inspects project details and returns a summarized breakdown for AI / CLI.
 */
export async function inspectProject(dir = process.cwd()) {
  const { project, projectDir } = await loadProject(dir);

  const duration = (project.entities || []).reduce((max, e) => {
    const end = (e.startTime || 0) + (e.duration || 0);
    return Math.max(max, end);
  }, 0);

  const scriptsDir = path.join(projectDir, 'scripts');
  let scriptFiles = [];
  try {
    const entries = await fs.readdir(scriptsDir);
    scriptFiles = entries.filter((f) => /\.(jsx?|tsx?)$/.test(f));
  } catch {
    // scripts directory might not exist yet
  }

  const mediaDir = path.join(projectDir, 'media');
  let mediaFiles = [];
  try {
    const entries = await fs.readdir(mediaDir);
    mediaFiles = entries.filter((f) => !f.startsWith('.'));
  } catch {
    // media directory might not exist yet
  }

  return {
    name: project.name,
    projectDir,
    resolution: project.resolution,
    schemaVersion: project.schemaVersion,
    totalDurationSeconds: duration,
    tracksCount: (project.tracks || []).length,
    entitiesCount: (project.entities || []).length,
    tracks: project.tracks || [],
    entities: (project.entities || []).map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      trackId: e.trackId,
      startTime: e.startTime,
      duration: e.duration,
      parentId: e.parentId || null,
      components: (e.components || []).map((c) => ({
        type: c.type,
        ...(c.scriptName ? { scriptName: c.scriptName } : {}),
      })),
      keyframeTracks: Object.keys(e.keyframes || {}),
    })),
    scriptsOnDisk: scriptFiles,
    mediaOnDisk: mediaFiles,
  };
}
