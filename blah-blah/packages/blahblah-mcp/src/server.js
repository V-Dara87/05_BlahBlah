import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs/promises';

import {
  initProject,
  loadProject,
  updateProject,
  inspectProject,
  listTracks,
  addTrack,
  removeTrack,
  addVideoClip,
  addAudioClip,
  addScriptEntity,
  removeEntity,
  setEntityProp,
  setEntityTransform,
  requireTrack,
  validateEntityProps,
  findEntity,
  addKeyframe,
  listKeyframes,
  removeKeyframes,
  createScript,
  listScripts,
  readScript,
  writeScript,
  loadScriptSchema,
  sanitizeScriptName,
  validateScript,
  evaluateTimelineAtTime,
  renderFrameSvg,
  renderFramePng,
  exportWithFfmpeg,
  sendFileCommand,
  sendHttpCommand,
  waitForResult,
  validateBridgeCommand,
  DEFAULT_BRIDGE_PORT,
  resolveProjectDir,
  assertAllowedPath,
  isInside,
  atomicWriteFile,
} from '../../blahblah-core/src/index.js';

const SERVER_VERSION = '0.2.0';
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const DIR = { type: 'string', description: 'Project directory path (required)' };

// MCP tool annotations (hints for the client, not security guarantees).
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ADDITIVE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const IDEMPOTENT_EDIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

export const TOOLS = [
  {
    name: 'blahblah_project_init',
    description:
      'Initializes a new BlahBlah video project folder with project.json and directories. Fails if a project already exists there.',
    annotations: ADDITIVE,
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Target project directory path' },
        name: { type: 'string', description: 'Project name' },
        resolution: {
          type: 'string',
          enum: ['1080p', '4k', '720p', 'reels', 'square'],
          description: 'Resolution preset (default 1080p)',
        },
      },
      required: ['dir'],
    },
  },
  {
    name: 'blahblah_project_inspect',
    description: 'Inspects a BlahBlah project: returns total duration, tracks, entities, scripts, and media.',
    annotations: READ_ONLY,
    inputSchema: { type: 'object', properties: { dir: DIR }, required: ['dir'] },
  },
  {
    name: 'blahblah_track_list',
    description: 'Lists the tracks of the project timeline.',
    annotations: READ_ONLY,
    inputSchema: { type: 'object', properties: { dir: DIR }, required: ['dir'] },
  },
  {
    name: 'blahblah_track_add',
    description: 'Adds a new track to the project timeline.',
    annotations: ADDITIVE,
    inputSchema: {
      type: 'object',
      properties: {
        dir: DIR,
        name: { type: 'string', description: 'Track display name' },
        id: { type: 'string', description: 'Optional unique track ID' },
      },
      required: ['dir', 'name'],
    },
  },
  {
    name: 'blahblah_track_remove',
    description:
      'Removes a track AND every entity on it (plus their child entities). The previous project.json is kept as project.json.bak.',
    annotations: DESTRUCTIVE,
    inputSchema: {
      type: 'object',
      properties: { dir: DIR, trackId: { type: 'string', description: 'Track ID to remove' } },
      required: ['dir', 'trackId'],
    },
  },
  {
    name: 'blahblah_clip_add',
    description: 'Adds a video clip (and by default its audio entity) to the timeline.',
    annotations: ADDITIVE,
    inputSchema: {
      type: 'object',
      properties: {
        dir: DIR,
        file: { type: 'string', description: 'Path to the media file, relative to the project folder (e.g. media/intro.mp4)' },
        name: { type: 'string', description: 'Display name for the clip' },
        trackId: { type: 'string', description: 'Target track ID (default: track-1)' },
        audioTrackId: { type: 'string', description: 'Track for the audio entity (default: track-2 if it exists)' },
        startTime: { type: 'number', description: 'Start time in seconds' },
        duration: { type: 'number', description: 'Duration in seconds' },
        includeAudio: { type: 'boolean', description: 'Whether to attach audio track entity (default true)' },
      },
      required: ['dir', 'file'],
    },
  },
  {
    name: 'blahblah_audio_add',
    description: 'Adds a standalone audio clip to the timeline.',
    annotations: ADDITIVE,
    inputSchema: {
      type: 'object',
      properties: {
        dir: DIR,
        file: { type: 'string', description: 'Path to the audio file, relative to the project folder' },
        name: { type: 'string', description: 'Display name for the clip' },
        trackId: { type: 'string', description: 'Target track ID (default: track-3)' },
        startTime: { type: 'number', description: 'Start time in seconds' },
        duration: { type: 'number', description: 'Duration in seconds' },
        volume: { type: 'number', description: 'Volume 0-1 (default 1)' },
      },
      required: ['dir', 'file'],
    },
  },
  {
    name: 'blahblah_entity_add',
    description:
      'Adds a script-driven entity to the timeline. The script must already exist in scripts/ (create it with blahblah_script_create or blahblah_script_write); initial props are checked against its static props.',
    annotations: ADDITIVE,
    inputSchema: {
      type: 'object',
      properties: {
        dir: DIR,
        name: { type: 'string', description: 'Entity name' },
        scriptName: { type: 'string', description: 'Name of the script file in scripts/ (e.g. MyOverlay)' },
        trackId: { type: 'string', description: 'Track ID to place entity on (default: track-1)' },
        startTime: { type: 'number', description: 'Start time in seconds' },
        duration: { type: 'number', description: 'Duration in seconds (default 5)' },
        props: { type: 'object', description: 'Initial props key-value dictionary' },
      },
      required: ['dir', 'name', 'scriptName'],
    },
  },
  {
    name: 'blahblah_entity_set_prop',
    description:
      "Updates a prop value for a script component on an entity. The prop name, type, range and select options are checked against the script's static props.",
    annotations: IDEMPOTENT_EDIT,
    inputSchema: {
      type: 'object',
      properties: {
        dir: DIR,
        entityId: { type: 'string', description: 'Entity ID or name' },
        propName: { type: 'string', description: 'Property key' },
        propValue: { description: 'New value (string, number, boolean, or object)' },
      },
      required: ['dir', 'entityId', 'propName', 'propValue'],
    },
  },
  {
    name: 'blahblah_entity_set_transform',
    description: 'Sets transform properties (x, y, scale, rotation, opacity 0-1) on an entity.',
    annotations: IDEMPOTENT_EDIT,
    inputSchema: {
      type: 'object',
      properties: {
        dir: DIR,
        entityId: { type: 'string', description: 'Entity ID or name' },
        x: { type: 'number' },
        y: { type: 'number' },
        scaleX: { type: 'number' },
        scaleY: { type: 'number' },
        rotation: { type: 'number' },
        opacity: { type: 'number' },
      },
      required: ['dir', 'entityId'],
    },
  },
  {
    name: 'blahblah_entity_remove',
    description: 'Removes an entity and any child entities from the project.',
    annotations: DESTRUCTIVE,
    inputSchema: {
      type: 'object',
      properties: { dir: DIR, entityId: { type: 'string', description: 'Entity ID to delete' } },
      required: ['dir', 'entityId'],
    },
  },
  {
    name: 'blahblah_keyframe_add',
    description:
      'Adds an animation keyframe to an entity property with easing. For script props use trackKey "script:<scriptId>" (see blahblah_project_inspect).',
    annotations: IDEMPOTENT_EDIT,
    inputSchema: {
      type: 'object',
      properties: {
        dir: DIR,
        entityId: { type: 'string', description: 'Entity ID' },
        trackKey: { type: 'string', description: 'Component type or script track key (default: Transform)' },
        field: { type: 'string', description: 'Field name (e.g. x, y, scaleX, opacity)' },
        time: { type: 'number', description: 'Local time offset in seconds from clip start' },
        value: { type: ['number', 'string', 'boolean'], description: 'Value at this keyframe' },
        ease: {
          type: 'string',
          enum: ['linear', 'easeIn', 'easeOut', 'easeInOut', 'snap', 'bounce', 'overshoot'],
          description: 'Easing curve preset',
        },
      },
      required: ['dir', 'entityId', 'field', 'time', 'value'],
    },
  },
  {
    name: 'blahblah_keyframe_list',
    description: 'Lists all keyframes of an entity, grouped by track key and field.',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: { dir: DIR, entityId: { type: 'string', description: 'Entity ID or name' } },
      required: ['dir', 'entityId'],
    },
  },
  {
    name: 'blahblah_keyframe_remove',
    description: 'Removes keyframes from an entity by keyframe id (ids come from blahblah_keyframe_list).',
    annotations: DESTRUCTIVE,
    inputSchema: {
      type: 'object',
      properties: {
        dir: DIR,
        entityId: { type: 'string', description: 'Entity ID or name' },
        keyframeIds: { type: 'array', items: { type: 'string' }, description: 'Keyframe ids to remove' },
      },
      required: ['dir', 'entityId', 'keyframeIds'],
    },
  },
  {
    name: 'blahblah_script_list',
    description: 'Lists the scripts in scripts/ with their kind (canvas, motion, react) and declared prop names.',
    annotations: READ_ONLY,
    inputSchema: { type: 'object', properties: { dir: DIR }, required: ['dir'] },
  },
  {
    name: 'blahblah_script_read',
    description: 'Reads a script from scripts/: returns its source and its declared props (type, default, min, max, options).',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: { dir: DIR, name: { type: 'string', description: 'Script name (e.g. LowerThird)' } },
      required: ['dir', 'name'],
    },
  },
  {
    name: 'blahblah_script_create',
    description:
      'Scaffolds a new script in the project scripts/ folder using @blahblah/sdk templates. Fails if the script already exists unless overwrite is true.',
    annotations: ADDITIVE,
    inputSchema: {
      type: 'object',
      properties: {
        dir: DIR,
        name: { type: 'string', description: 'Script name (e.g. LowerThird)' },
        type: { type: 'string', enum: ['canvas', 'motion', 'react', 'codesnippet'], description: 'Script template kind' },
        overwrite: { type: 'boolean', description: 'Replace an existing script (a .bak copy is kept). Default false.' },
      },
      required: ['dir', 'name'],
    },
  },
  {
    name: 'blahblah_script_write',
    description:
      'Writes the full source of a script to scripts/<name>.jsx. The code is syntax-checked first and NOT written if it has errors (the errors come back with line numbers). Replacing an existing script requires overwrite: true and keeps a .bak copy.',
    annotations: IDEMPOTENT_EDIT,
    inputSchema: {
      type: 'object',
      properties: {
        dir: DIR,
        name: { type: 'string', description: 'Script name (e.g. LowerThird)' },
        code: { type: 'string', description: 'Complete script source (must have a default export)' },
        overwrite: { type: 'boolean', description: 'Replace an existing script. Default false.' },
      },
      required: ['dir', 'name', 'code'],
    },
  },
  {
    name: 'blahblah_script_validate',
    description:
      'Validates script syntax, default export and static props. Pass `code` for source text, or `dir` + `name` for a script in scripts/ (a `filePath` inside a scripts folder also works). Errors include line and column.',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path (with name)' },
        name: { type: 'string', description: 'Script name in scripts/' },
        code: { type: 'string', description: 'Script source text to check' },
        filePath: { type: 'string', description: 'Path to a script file inside a "scripts" folder' },
      },
    },
  },
  {
    name: 'blahblah_render_frame',
    description:
      'Evaluates the timeline at a specific second and returns the evaluated entities plus a SCHEMATIC frame (SVG, or PNG as an image). The picture shows each active entity as a labelled box at its transform; it does NOT draw what the entity scripts render, so it cannot be used to judge the final look.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        dir: DIR,
        time: { type: 'number', description: 'Playback time in seconds' },
        outFile: { type: 'string', description: 'Optional output path inside the project folder (.svg or .png)' },
        format: {
          type: 'string',
          enum: ['svg', 'png'],
          description: 'svg (default) or png (returned as an image content block)',
        },
        source: {
          type: 'string',
          enum: ['editor', 'schematic'],
          description: 'Frame source: editor (default) or schematic.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Wait timeout in ms for open editor. Default 500.',
        },
      },
      required: ['dir', 'time'],
    },
  },
  {
    name: 'blahblah_export_plan',
    description:
      'Builds (does not run) an ffmpeg command line for the project. PLAN ONLY: the command renders a black placeholder, not the real timeline.',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: {
        dir: DIR,
        outFile: { type: 'string', description: 'Output .mp4 path inside the project folder (default output.mp4)' },
        quality: { type: 'string', enum: ['high', 'ultra', 'draft'] },
        fps: { type: 'number', description: 'Frames per second (default 60)' },
      },
      required: ['dir'],
    },
  },
  {
    name: 'blahblah_live_control',
    description:
      'Queues a command (seek, reload, select, play, pause) for a running BlahBlah editor. The result says whether an editor actually received it ("delivered") or whether it is only queued; set waitMs to wait for the editor to answer.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        dir: DIR,
        command: { type: 'string', enum: ['seek', 'reload', 'select', 'play', 'pause'] },
        arg: { description: 'seek: time in seconds. select: entity id or name.' },
        waitMs: { type: 'number', description: 'Wait up to this many ms (max 30000) for the editor to answer. Default 0.' },
      },
      required: ['dir', 'command'],
    },
  },
];

// ─── helpers ────────────────────────────────────────────────────────────────

function requireDir(args) {
  return resolveProjectDir(args?.dir, { required: true });
}

/** A media path must stay inside the project: relative, no "..". */
function checkMediaPath(file) {
  if (typeof file !== 'string' || file.trim() === '') throw new Error('"file" is required.');
  if (path.isAbsolute(file) || /^[a-zA-Z]:[\\/]/.test(file)) {
    throw new Error('"file" must be relative to the project folder (e.g. media/clip.mp4).');
  }
  const normalized = path.posix.normalize(file.replace(/\\/g, '/'));
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('"file" must stay inside the project folder.');
  }
  return normalized;
}

function numberOr(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`"${label}" must be a number.`);
  }
  return value;
}

/**
 * Resolves an output file path and makes sure it stays inside the project
 * directory and has an allowed extension. Prevents a prompt-injected client
 * from writing to arbitrary locations through `outFile`.
 */
function resolveOutFile(baseDir, outFile, extensions) {
  const resolved = path.resolve(baseDir, String(outFile));
  if (resolved === baseDir || !isInside(baseDir, resolved)) {
    throw new Error('outFile must be inside the project directory.');
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!extensions.includes(ext)) {
    throw new Error(`outFile must end with ${extensions.join(' or ')}.`);
  }
  return assertAllowedPath(resolved);
}

/** For a legacy `filePath` argument: the project is the parent of its "scripts" folder. */
function projectDirFromScriptPath(filePath) {
  const resolved = path.resolve(filePath);
  const parent = path.dirname(resolved);
  if (path.basename(parent) !== 'scripts') {
    throw new Error('Script files must be inside the project "scripts" folder.');
  }
  return path.dirname(parent);
}

async function scriptSchemaForEntity(dir, entity) {
  const comp = (entity.components || []).find((c) => c.type === 'ScriptComponent');
  if (!comp || !comp.scriptName) return null;
  return loadScriptSchema(dir, comp.scriptName);
}

// ─── tool implementations ───────────────────────────────────────────────────

export async function handleToolCall(name, args = {}) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Tool arguments must be an object.');
  }

  switch (name) {
    case 'blahblah_project_init': {
      const dir = requireDir(args);
      return await initProject({
        dir,
        name: args.name || 'Untitled Project',
        resolution: args.resolution || '1080p',
      });
    }
    case 'blahblah_project_inspect': {
      return await inspectProject(requireDir(args));
    }
    case 'blahblah_track_list': {
      const { project } = await loadProject(requireDir(args));
      return listTracks(project);
    }
    case 'blahblah_track_add': {
      const dir = requireDir(args);
      return await updateProject(dir, (project) => addTrack(project, { name: args.name, id: args.id }));
    }
    case 'blahblah_track_remove': {
      const dir = requireDir(args);
      return await updateProject(dir, (project) => {
        const before = (project.entities || []).length;
        const track = removeTrack(project, args.trackId);
        return { removedTrack: track, removedEntities: before - (project.entities || []).length };
      });
    }
    case 'blahblah_clip_add': {
      const dir = requireDir(args);
      const file = checkMediaPath(args.file);
      return await updateProject(dir, (project) => {
        const trackId = args.trackId || 'track-1';
        requireTrack(project, trackId);
        let audioTrackId = args.audioTrackId;
        if (audioTrackId) requireTrack(project, audioTrackId);
        else audioTrackId = (project.tracks || []).some((t) => t.id === 'track-2') ? 'track-2' : trackId;
        return addVideoClip(project, {
          file,
          name: args.name,
          trackId,
          audioTrackId,
          startTime: numberOr(args.startTime, 0, 'startTime'),
          duration: numberOr(args.duration, 5, 'duration'),
          includeAudio: args.includeAudio !== false,
        });
      });
    }
    case 'blahblah_audio_add': {
      const dir = requireDir(args);
      const file = checkMediaPath(args.file);
      return await updateProject(dir, (project) => {
        const trackId = args.trackId || 'track-3';
        requireTrack(project, trackId);
        return addAudioClip(project, {
          file,
          name: args.name,
          trackId,
          startTime: numberOr(args.startTime, 0, 'startTime'),
          duration: numberOr(args.duration, 5, 'duration'),
          volume: numberOr(args.volume, 1, 'volume'),
        });
      });
    }
    case 'blahblah_entity_add': {
      const dir = requireDir(args);
      const scriptName = sanitizeScriptName(args.scriptName);
      const schema = await loadScriptSchema(dir, scriptName);
      if (!schema) {
        throw new Error(
          `Script "${scriptName}" not found in scripts/. Create it first with blahblah_script_create or blahblah_script_write.`
        );
      }
      const props = args.props ?? {};
      if (typeof props !== 'object' || Array.isArray(props)) throw new Error('"props" must be an object.');
      const propErrors = validateEntityProps(schema, props);
      if (propErrors.length > 0) throw new Error(`Invalid props:\n${propErrors.join('\n')}`);

      return await updateProject(dir, (project) => {
        const trackId = args.trackId || 'track-1';
        requireTrack(project, trackId);
        return addScriptEntity(project, {
          name: args.name,
          scriptName,
          trackId,
          startTime: numberOr(args.startTime, 0, 'startTime'),
          duration: numberOr(args.duration, 5, 'duration'),
          props,
        });
      });
    }
    case 'blahblah_entity_set_prop': {
      const dir = requireDir(args);
      const { project: current } = await loadProject(dir);
      const target = findEntity(current, args.entityId);
      if (!target) throw new Error(`Entity "${args.entityId}" not found.`);
      const schema = await scriptSchemaForEntity(dir, target);

      const updatedProps = await updateProject(dir, (project) =>
        setEntityProp(project, target.id, args.propName, args.propValue, { schema })
      );
      return {
        entityId: target.id,
        updatedProps,
        ...(schema ? {} : { warning: 'The entity script was not found or declares no props, so the value was not checked.' }),
      };
    }
    case 'blahblah_entity_set_transform': {
      const dir = requireDir(args);
      const updates = {};
      for (const key of ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity']) {
        if (args[key] !== undefined) updates[key] = args[key];
      }
      if (Object.keys(updates).length === 0) throw new Error('Give at least one of x, y, scaleX, scaleY, rotation, opacity.');
      return await updateProject(dir, (project) => {
        const entity = findEntity(project, args.entityId);
        if (!entity) throw new Error(`Entity "${args.entityId}" not found.`);
        const transform = setEntityTransform(project, entity.id, updates);
        return { entityId: entity.id, transform };
      });
    }
    case 'blahblah_entity_remove': {
      const dir = requireDir(args);
      return await updateProject(dir, (project) => removeEntity(project, args.entityId));
    }
    case 'blahblah_keyframe_add': {
      const dir = requireDir(args);
      return await updateProject(dir, (project) =>
        addKeyframe(project, args.entityId, {
          trackKey: args.trackKey || 'Transform',
          field: args.field,
          time: args.time,
          value: args.value,
          ease: args.ease || 'linear',
        })
      );
    }
    case 'blahblah_keyframe_list': {
      const { project } = await loadProject(requireDir(args));
      return listKeyframes(project, args.entityId);
    }
    case 'blahblah_keyframe_remove': {
      const dir = requireDir(args);
      if (!Array.isArray(args.keyframeIds) || args.keyframeIds.length === 0) {
        throw new Error('"keyframeIds" must be a non-empty array of keyframe ids.');
      }
      return await updateProject(dir, (project) => {
        const entity = findEntity(project, args.entityId);
        if (!entity) throw new Error(`Entity "${args.entityId}" not found.`);
        return removeKeyframes(project, entity.id, args.keyframeIds);
      });
    }
    case 'blahblah_script_list': {
      return await listScripts(requireDir(args));
    }
    case 'blahblah_script_read': {
      return await readScript(requireDir(args), args.name);
    }
    case 'blahblah_script_create': {
      return await createScript({
        dir: requireDir(args),
        name: args.name,
        type: args.type || 'canvas',
        overwrite: args.overwrite === true,
      });
    }
    case 'blahblah_script_write': {
      return await writeScript({
        dir: requireDir(args),
        name: args.name,
        code: args.code,
        overwrite: args.overwrite === true,
      });
    }
    case 'blahblah_script_validate': {
      if (typeof args.code === 'string') {
        return await validateScript(args.code);
      }
      if (args.name) {
        const script = await readScript(requireDir(args), args.name);
        return await validateScript(script.filePath, { baseDir: requireDir(args) });
      }
      if (args.filePath) {
        const baseDir = args.dir ? requireDir(args) : projectDirFromScriptPath(args.filePath);
        return await validateScript(args.filePath, { baseDir });
      }
      throw new Error('Give `code`, or `dir` and `name`, or a `filePath` inside a scripts folder.');
    }
    case 'blahblah_render_frame': {
      const dir = requireDir(args);
      const time = args.time;
      if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
        throw new Error('"time" must be a number >= 0.');
      }
      const { project } = await loadProject(dir);
      const evaluated = evaluateTimelineAtTime(project, time);
      const isExplicitSvg = args.format === 'svg' || (!args.format && /\.svg$/i.test(args.outFile || ''));
      const source = args.source || (isExplicitSvg ? 'schematic' : 'editor');
      const timeoutMs = Math.min(Math.max(numberOr(args.timeoutMs, 500, 'timeoutMs'), 50), 30000);

      if (source === 'editor') {
        try {
          const payload = validateBridgeCommand({
            type: 'render_frame',
            arg: { time, format: 'png' },
          });
          const sent = await sendFileCommand(dir, payload);
          const port = Number(process.env.BLAHBLAH_BRIDGE_PORT) || DEFAULT_BRIDGE_PORT;
          sendHttpCommand(payload, port, { projectDir: dir }).catch(() => {});

          const result = await waitForResult(dir, sent.id, { timeoutMs, intervalMs: 30 });
          if (result && result.ok) {
            let pngBase64 = result.pngBase64;
            if (!pngBase64) {
              const pngPath = path.resolve(dir, '.aibridge', 'outbox', `${sent.id}.png`);
              try {
                const buf = await fs.promises.readFile(pngPath);
                pngBase64 = buf.toString('base64');
              } catch {
                // unreadable
              }
            }
            if (pngBase64) {
              let pngFile = null;
              if (args.outFile) {
                pngFile = resolveOutFile(dir, args.outFile, ['.png']);
                await atomicWriteFile(pngFile, Buffer.from(pngBase64, 'base64'));
              }
              return {
                ...evaluated,
                fidelity: 'editor',
                note: 'Real composited frame rendered through open BlahBlah editor.',
                format: 'png',
                width: result.width,
                height: result.height,
                pngBase64,
                pngFile,
              };
            }
          }
        } catch {
          // Fall through to schematic frame
        }
      }

      const fidelity = {
        fidelity: 'schematic',
        note:
          source === 'schematic'
            ? 'Schematic preview: entities are drawn as boxes at their evaluated transform. Script output is not rendered.'
            : 'Editor did not respond within timeout; fell back to schematic preview: entities are drawn as boxes at their evaluated transform. Script output is not rendered.',
      };
      const wantsPng = args.format === 'png' || (!args.format && /\.png$/i.test(args.outFile || ''));
      if (wantsPng) {
        const buf = renderFramePng(project, time);
        let pngFile = null;
        if (args.outFile) {
          pngFile = resolveOutFile(dir, args.outFile, ['.png']);
          await atomicWriteFile(pngFile, buf);
        }
        return { ...evaluated, ...fidelity, format: 'png', pngBase64: buf.toString('base64'), pngFile };
      }
      const svg = renderFrameSvg(project, time);
      if (args.outFile) {
        const svgFile = resolveOutFile(dir, args.outFile, ['.svg']);
        await atomicWriteFile(svgFile, svg);
        return { ...evaluated, ...fidelity, format: 'svg', svgFile };
      }
      return { ...evaluated, ...fidelity };
    }
    case 'blahblah_export_plan': {
      const dir = requireDir(args);
      const outputPath = resolveOutFile(dir, args.outFile || 'output.mp4', ['.mp4']);
      return await exportWithFfmpeg({
        projectDir: dir,
        outputPath,
        quality: args.quality || 'high',
        fps: numberOr(args.fps, 60, 'fps'),
      });
    }
    case 'blahblah_live_control': {
      const dir = requireDir(args);
      const payload = validateBridgeCommand({ type: args.command, arg: args.arg });
      const waitMs = Math.min(Math.max(numberOr(args.waitMs, 0, 'waitMs'), 0), 30000);

      const sent = await sendFileCommand(dir, payload);
      const port = Number(process.env.BLAHBLAH_BRIDGE_PORT) || DEFAULT_BRIDGE_PORT;

      let http = null;
      let httpError = null;
      try {
        http = await sendHttpCommand(payload, port, { projectDir: dir });
      } catch (err) {
        httpError = err.message;
      }

      const applied = waitMs > 0 ? await waitForResult(dir, sent.id, { timeoutMs: waitMs }) : null;
      const delivered = Boolean(http && http.delivered) || applied !== null;

      return {
        status: delivered ? 'delivered' : 'queued',
        delivered,
        commandId: sent.id,
        payload,
        applied,
        ...(delivered
          ? {}
          : {
              note:
                'The command was written to .aibridge/inbox, but no running BlahBlah editor acknowledged it, so nothing has happened yet.' +
                (httpError ? ` (Live bridge: ${httpError})` : ''),
            }),
      };
    }
    default: {
      const err = new Error(`Unknown tool: ${name}`);
      err.code = -32602;
      throw err;
    }
  }
}

/**
 * Converts a tool result into MCP content blocks. A PNG is sent as an image
 * block instead of base64 text inside the JSON (which costs far more tokens).
 */
export function toMcpContent(result) {
  const content = [];
  let data = result;
  if (result && typeof result === 'object' && typeof result.pngBase64 === 'string') {
    const { pngBase64, ...rest } = result;
    data = { ...rest, imageIncluded: true };
    content.push({ type: 'image', data: pngBase64, mimeType: 'image/png' });
  }
  content.unshift({ type: 'text', text: JSON.stringify(data, null, 2) });
  return content;
}

// ─── JSON-RPC server over stdio ─────────────────────────────────────────────

export function startMcpServer({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, output, terminal: false });

  const send = (message) => {
    output.write(JSON.stringify(message) + '\n');
  };

  const handleRequest = async (request) => {
    const { id, method, params } = request;
    const isRequest = id !== undefined && id !== null;

    try {
      if (method === 'initialize') {
        const requested = params?.protocolVersion;
        send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: { name: 'blahblah-mcp-server', version: SERVER_VERSION },
          },
        });
        return;
      }

      if (method === 'ping') {
        if (isRequest) send({ jsonrpc: '2.0', id, result: {} });
        return;
      }

      if (typeof method === 'string' && method.startsWith('notifications/')) return;

      if (method === 'tools/list') {
        send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
        return;
      }

      if (method === 'tools/call') {
        const toolName = params?.name;
        if (typeof toolName !== 'string' || !TOOLS.some((t) => t.name === toolName)) {
          send({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Unknown tool: ${toolName}` },
          });
          return;
        }

        try {
          const result = await handleToolCall(toolName, params?.arguments ?? {});
          send({ jsonrpc: '2.0', id, result: { content: toMcpContent(result) } });
        } catch (err) {
          // Tool failures are reported inside the result so the model can read
          // the message and correct its next call.
          send({
            jsonrpc: '2.0',
            id,
            result: { isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] },
          });
        }
        return;
      }

      if (isRequest) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
    } catch (err) {
      if (isRequest) {
        send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
      }
    }
  };

  // Tool calls run strictly one after another, so two quick calls from a client
  // can never edit the same project at the same time.
  let toolQueue = Promise.resolve();

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      return;
    }

    if (request.method === 'tools/call') {
      toolQueue = toolQueue.then(() => handleRequest(request)).catch(() => {});
    } else {
      handleRequest(request).catch(() => {});
    }
  });

  return rl;
}