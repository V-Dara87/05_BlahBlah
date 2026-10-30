import fs from 'node:fs/promises';
import path from 'node:path';
import {
  atomicWriteFile,
  hashText,
  resolveProjectDir,
  withLock,
} from './fsutil.js';

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
  overwrite = false,
} = {}) {
  const projectDir = resolveProjectDir(dir);
  const projectFilePath = path.join(projectDir, 'project.json');
  if (!overwrite) {
    const exists = await fs.access(projectFilePath).then(() => true, () => false);
    if (exists) {
      throw new Error(
        `A project already exists at "${projectFilePath}". Pass overwrite: true to replace it.`
      );
    }
  }
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
    // Deep copy: the shared defaults must never be mutated by edits to one project.
    tracks: DEFAULT_TRACKS.map((t) => ({ ...t })),
    entities: [],
    scriptIndex: [],
  };

  await atomicWriteFile(projectFilePath, JSON.stringify(projectData, null, 2), { backup: true });

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
  await atomicWriteFile(
    path.join(projectDir, 'scripts', 'jsconfig.json'),
    JSON.stringify(jsconfig, null, 2)
  );

  return {
    projectDir,
    projectFilePath,
    project: projectData,
  };
}

export class ProjectConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProjectConflictError';
    this.code = 'EPROJECT_CONFLICT';
  }
}

async function readProjectFile(projectFilePath) {
  let raw;
  try {
    raw = await fs.readFile(projectFilePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`No project.json found at "${projectFilePath}". Run 'blahblah project init' first.`);
    }
    throw err;
  }

  let project;
  try {
    project = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse project.json at "${projectFilePath}": ${err.message}. ` +
        `A backup may exist at "${projectFilePath}.bak".`
    );
  }
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new Error(`project.json at "${projectFilePath}" must contain a JSON object.`);
  }
  if (
    typeof project.schemaVersion === 'number' &&
    project.schemaVersion > CURRENT_SCHEMA_VERSION
  ) {
    throw new Error(
      `project.json uses schemaVersion ${project.schemaVersion}, which is newer than this tool supports ` +
        `(${CURRENT_SCHEMA_VERSION}). Update BlahBlah before editing this project.`
    );
  }
  return { raw, project };
}

/**
 * Loads project.json from a project directory. The returned `revision` is a
 * hash of the file as read; pass it to saveProject to detect concurrent edits.
 */
export async function loadProject(dir = process.cwd()) {
  const projectDir = resolveProjectDir(dir);
  const projectFilePath = path.join(projectDir, 'project.json');
  const { raw, project } = await readProjectFile(projectFilePath);
  return { projectDir, projectFilePath, project, revision: hashText(raw) };
}

/**
 * Saves project data back to project.json atomically, keeping the previous
 * version as project.json.bak. When `expectedRevision` is given, the save is
 * refused if the file changed on disk since it was loaded.
 */
export async function saveProject(dir = process.cwd(), project, { expectedRevision } = {}) {
  const projectDir = resolveProjectDir(dir);
  const projectFilePath = path.join(projectDir, 'project.json');

  if (expectedRevision !== undefined) {
    let currentRaw = null;
    try {
      currentRaw = await fs.readFile(projectFilePath, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (currentRaw === null || hashText(currentRaw) !== expectedRevision) {
      throw new ProjectConflictError(
        'project.json changed on disk while it was being edited (is the editor saving at the same time?).'
      );
    }
  }

  project.lastModified = Date.now();
  await atomicWriteFile(projectFilePath, JSON.stringify(project, null, 2), { backup: true });
  return { projectDir, projectFilePath, project };
}

/**
 * Safe read-modify-write. Edits for the same project run one at a time, the
 * file is re-read right before `mutator` runs, and a concurrent change made by
 * another process makes the cycle retry. If `mutator` throws, nothing is
 * written. Returns whatever `mutator` returns.
 */
export async function updateProject(dir, mutator, { retries = 4 } = {}) {
  const projectDir = resolveProjectDir(dir);
  const lockKey = path.join(projectDir, 'project.json');

  return withLock(lockKey, async () => {
    for (let attempt = 0; ; attempt++) {
      const { project, revision } = await loadProject(projectDir);
      const result = await mutator(project, { projectDir });
      try {
        await saveProject(projectDir, project, { expectedRevision: revision });
        return result;
      } catch (err) {
        if (err instanceof ProjectConflictError && attempt < retries) continue;
        throw err;
      }
    }
  });
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