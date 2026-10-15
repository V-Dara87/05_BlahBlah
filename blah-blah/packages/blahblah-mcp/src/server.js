import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs/promises';

import {
  initProject,
  loadProject,
  saveProject,
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
  addKeyframe,
  listKeyframes,
  createScript,
  listScripts,
  validateScript,
  evaluateTimelineAtTime,
  renderFrameSvg,
  renderFramePng,
  sendFileCommand,
  sendHttpCommand,
} from '../../blahblah-core/src/index.js';

export const TOOLS = [
  {
    name: 'blahblah_project_init',
    description: 'Initializes a new BlahBlah video project folder with project.json and directories.',
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
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
      },
      required: ['dir'],
    },
  },
  {
    name: 'blahblah_track_add',
    description: 'Adds a new track to the project timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        name: { type: 'string', description: 'Track display name' },
        id: { type: 'string', description: 'Optional unique track ID' },
      },
      required: ['dir', 'name'],
    },
  },
  {
    name: 'blahblah_clip_add',
    description: 'Adds a video or audio clip to the timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        file: { type: 'string', description: 'Relative path to media file' },
        name: { type: 'string', description: 'Display name for the clip' },
        trackId: { type: 'string', description: 'Target track ID (default: track-1)' },
        startTime: { type: 'number', description: 'Start time in seconds' },
        duration: { type: 'number', description: 'Duration in seconds' },
        includeAudio: { type: 'boolean', description: 'Whether to attach audio track entity' },
      },
      required: ['dir', 'file'],
    },
  },
  {
    name: 'blahblah_entity_add',
    description: 'Adds a script-driven motion entity (CanvasComponent, MotionScript, React) to the timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        name: { type: 'string', description: 'Entity name' },
        scriptName: { type: 'string', description: 'Name of the script file in scripts/ (e.g. MyOverlay)' },
        trackId: { type: 'string', description: 'Track ID to place entity on' },
        startTime: { type: 'number', description: 'Start time in seconds' },
        duration: { type: 'number', description: 'Duration in seconds' },
        props: { type: 'object', description: 'Initial props key-value dictionary' },
      },
      required: ['dir', 'name', 'scriptName'],
    },
  },
  {
    name: 'blahblah_entity_set_prop',
    description: 'Updates a prop value for a script component on an entity.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        entityId: { type: 'string', description: 'Entity ID or name' },
        propName: { type: 'string', description: 'Property key' },
        propValue: { description: 'New value (string, number, boolean, or object)' },
      },
      required: ['dir', 'entityId', 'propName', 'propValue'],
    },
  },
  {
    name: 'blahblah_entity_set_transform',
    description: 'Sets transform properties (x, y, scale, rotation, opacity) on an entity.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
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
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        entityId: { type: 'string', description: 'Entity ID to delete' },
      },
      required: ['dir', 'entityId'],
    },
  },
  {
    name: 'blahblah_keyframe_add',
    description: 'Adds an animation keyframe to an entity property with easing.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        entityId: { type: 'string', description: 'Entity ID' },
        trackKey: { type: 'string', description: 'Component type or script track key (default: Transform)' },
        field: { type: 'string', description: 'Field name (e.g. x, y, scaleX, opacity)' },
        time: { type: 'number', description: 'Local time offset in seconds from clip start' },
        value: { type: 'number', description: 'Value at this keyframe' },
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
    name: 'blahblah_script_create',
    description: 'Scaffolds a new script in the project scripts/ folder using @blahblah/sdk templates.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        name: { type: 'string', description: 'Script name (e.g. LowerThird)' },
        type: { type: 'string', enum: ['canvas', 'motion', 'react', 'codesnippet'], description: 'Script template kind' },
      },
      required: ['dir', 'name'],
    },
  },
  {
    name: 'blahblah_script_validate',
    description: 'Validates script syntax, exports, and static props declaration.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to script file' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'blahblah_render_frame',
    description: 'Evaluates the timeline at a specific second and generates a frame snapshot. Supports SVG (default) or PNG raster output. PNG returns pngBase64 field enabling AI visual feedback.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        time: { type: 'number', description: 'Playback time in seconds' },
        outFile: { type: 'string', description: 'Optional output file path to save (.svg or .png)' },
        format: {
          type: 'string',
          enum: ['svg', 'png'],
          description: 'Output format: svg (default) or png for raster image. PNG enables visual AI feedback via base64.',
        },
      },
      required: ['dir', 'time'],
    },
  },
  {
    name: 'blahblah_live_control',
    description: 'Sends live commands to the running BlahBlah application (seek playhead, reload scripts).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project directory path' },
        command: { type: 'string', enum: ['seek', 'reload', 'select', 'play', 'pause'] },
        arg: { description: 'Command argument (e.g. timestamp for seek)' },
      },
      required: ['dir', 'command'],
    },
  },
];

export async function handleToolCall(name, args) {
  const dir = args?.dir ? path.resolve(args.dir) : process.cwd();

  switch (name) {
    case 'blahblah_project_init': {
      const res = await initProject({
        dir,
        name: args.name || 'Untitled Project',
        resolution: args.resolution || '1080p',
      });
      return res;
    }
    case 'blahblah_project_inspect': {
      return await inspectProject(dir);
    }
    case 'blahblah_track_add': {
      const { project } = await loadProject(dir);
      const track = addTrack(project, { name: args.name, id: args.id });
      await saveProject(dir, project);
      return track;
    }
    case 'blahblah_clip_add': {
      const { project } = await loadProject(dir);
      const res = addVideoClip(project, {
        file: args.file,
        name: args.name,
        trackId: args.trackId || 'track-1',
        startTime: args.startTime || 0,
        duration: args.duration || 5,
        includeAudio: args.includeAudio !== false,
      });
      await saveProject(dir, project);
      return res;
    }
    case 'blahblah_entity_add': {
      const { project } = await loadProject(dir);
      const entity = addScriptEntity(project, {
        name: args.name,
        scriptName: args.scriptName,
        trackId: args.trackId || 'track-1',
        startTime: args.startTime || 0,
        duration: args.duration || 5,
        props: args.props || {},
      });
      await saveProject(dir, project);
      return entity;
    }
    case 'blahblah_entity_set_prop': {
      const { project } = await loadProject(dir);
      const props = setEntityProp(project, args.entityId, args.propName, args.propValue);
      await saveProject(dir, project);
      return { entityId: args.entityId, updatedProps: props };
    }
    case 'blahblah_entity_set_transform': {
      const { project } = await loadProject(dir);
      const updates = {};
      if (args.x !== undefined) updates.x = args.x;
      if (args.y !== undefined) updates.y = args.y;
      if (args.scaleX !== undefined) updates.scaleX = args.scaleX;
      if (args.scaleY !== undefined) updates.scaleY = args.scaleY;
      if (args.rotation !== undefined) updates.rotation = args.rotation;
      if (args.opacity !== undefined) updates.opacity = args.opacity;

      const transform = setEntityTransform(project, args.entityId, updates);
      await saveProject(dir, project);
      return { entityId: args.entityId, transform };
    }
    case 'blahblah_entity_remove': {
      const { project } = await loadProject(dir);
      const rm = removeEntity(project, args.entityId);
      await saveProject(dir, project);
      return rm;
    }
    case 'blahblah_keyframe_add': {
      const { project } = await loadProject(dir);
      const kf = addKeyframe(project, args.entityId, {
        trackKey: args.trackKey || 'Transform',
        field: args.field,
        time: args.time,
        value: args.value,
        ease: args.ease || 'linear',
      });
      await saveProject(dir, project);
      return kf;
    }
    case 'blahblah_script_create': {
      return await createScript({
        dir,
        name: args.name,
        type: args.type || 'canvas',
      });
    }
    case 'blahblah_script_validate': {
      return await validateScript(args.filePath);
    }
    case 'blahblah_render_frame': {
      const { project } = await loadProject(dir);
      const evaluated = evaluateTimelineAtTime(project, args.time);
      const isPng = args.format === 'png' || args.outFile?.endsWith('.png');
      if (isPng) {
        const buf = renderFramePng(project, args.time);
        if (args.outFile) {
          const outPath = path.resolve(args.outFile);
          await fs.writeFile(outPath, buf);
        }
        return { ...evaluated, format: 'png', pngBase64: buf.toString('base64'), pngFile: args.outFile || null };
      }
      if (args.outFile) {
        const outPath = path.resolve(args.outFile);
        const svg = renderFrameSvg(project, args.time);
        await fs.writeFile(outPath, svg, 'utf8');
        return { ...evaluated, svgFile: outPath };
      }
      return evaluated;
    }
    case 'blahblah_live_control': {
      const payload = { type: args.command, arg: args.arg };
      await sendFileCommand(dir, payload);
      try {
        await sendHttpCommand(payload);
      } catch {
        // file command was sent
      }
      return { status: 'sent', payload };
    }
    default:
      throw new Error(`Tool "${name}" not found.`);
  }
}

export function startMcpServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const sendResponse = (response) => {
    process.stdout.write(JSON.stringify(response) + '\n');
  };

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      return;
    }

    const { id, method, params } = request;

    try {
      if (method === 'initialize') {
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'blahblah-mcp-server',
              version: '0.1.0',
            },
          },
        });
        return;
      }

      if (method === 'notifications/initialized') {
        // notification - no response required
        return;
      }

      if (method === 'tools/list') {
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            tools: TOOLS,
          },
        });
        return;
      }

      if (method === 'tools/call') {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};
        const result = await handleToolCall(toolName, toolArgs);

        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        });
        return;
      }

      if (id !== undefined) {
        sendResponse({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        });
      }
    } catch (err) {
      if (id !== undefined) {
        sendResponse({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: err.message,
          },
        });
      }
    }
  });
}
