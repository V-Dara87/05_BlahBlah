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
  findEntity,
  addKeyframe,
  listKeyframes,
  removeKeyframes,
  createScript,
  listScripts,
  validateScript,
  evaluateTimelineAtTime,
  renderFrameSvg,
  renderFramePng,
  exportWithFfmpeg,
  sendFileCommand,
  sendHttpCommand,
  startBridgeServer,
} from '../../blahblah-core/src/index.js';

function parseArgs(args) {
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key.startsWith('no-')) {
        options[key.slice(3)] = false;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options[key] = args[i + 1];
        i++;
      } else {
        options[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, options };
}

function printOutput(data, options, message = '') {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    if (message) console.log(message);
    if (data !== undefined && data !== null && typeof data === 'object') {
      console.log(JSON.stringify(data, null, 2));
    } else if (data) {
      console.log(data);
    }
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const { positional, options } = parseArgs(argv);
  const command = positional[0];
  const subcommand = positional[1];
  const projectDir = path.resolve(options.dir || process.cwd());

  if (!command || command === 'help' || options.help) {
    console.log(`
blahblah CLI — Automation & Tooling for BlahBlah Video Editor

Usage:
  blahblah project init [name] [--dir <path>] [--res <1080p|4k|reels|square>] [--json]
  blahblah project inspect [--dir <path>] [--json]

  blahblah track list [--dir <path>] [--json]
  blahblah track add <name> [--dir <path>] [--json]
  blahblah track remove <id> [--dir <path>] [--json]

  blahblah clip add --file <path> [--name <name>] [--track <id>] [--start <sec>] [--duration <sec>] [--dir <path>] [--json]
  blahblah entity add --name <name> --script <scriptName> [--track <id>] [--start <sec>] [--duration <sec>] [--props <json>] [--dir <path>] [--json]
  blahblah entity remove <id> [--dir <path>] [--json]
  blahblah entity set-prop --id <id> --prop <key=val> [--dir <path>] [--json]
  blahblah entity set-transform --id <id> [--x <n>] [--y <n>] [--scale <n>] [--rot <deg>] [--opacity <n>] [--dir <path>] [--json]

  blahblah keyframe add --id <id> --field <name> --time <sec> --value <val> [--ease <ease>] [--track-key <key>] [--dir <path>] [--json]
  blahblah keyframe list --id <id> [--dir <path>] [--json]

  blahblah script new <name> [--type <canvas|motion|react|codesnippet>] [--dir <path>] [--json]
  blahblah script list [--dir <path>] [--json]
  blahblah script check <file> [--json]

  blahblah render frame --time <sec> [--out <file.svg|file.png>] [--dir <path>] [--json]
  blahblah render export [--out <file.mp4>] [--quality <high|ultra>] [--dir <path>] [--json]

  blahblah bridge send --cmd <seek|reload|select> [--arg <val>] [--dir <path>]
  blahblah bridge start [--port <9876>]
`);
    return;
  }

  try {
    // ─── PROJECT COMMANDS ──────────────────────────────────────────────────
    if (command === 'project') {
      if (subcommand === 'init') {
        const name = positional[2] || 'Untitled Project';
        const res = await initProject({
          dir: projectDir,
          name,
          resolution: options.res || '1080p',
        });
        printOutput(res.project, options, `✓ Initialized project "${name}" at ${res.projectDir}`);
        return;
      }
      if (subcommand === 'inspect') {
        const inspected = await inspectProject(projectDir);
        printOutput(inspected, options);
        return;
      }
      throw new Error(`Unknown project subcommand: "${subcommand}"`);
    }

    // ─── TRACK COMMANDS ────────────────────────────────────────────────────
    if (command === 'track') {
      const { project } = await loadProject(projectDir);

      if (subcommand === 'list') {
        const tracks = listTracks(project);
        printOutput(tracks, options);
        return;
      }
      if (subcommand === 'add') {
        const name = positional[2] || options.name;
        const newTrack = addTrack(project, { name, id: options.id });
        await saveProject(projectDir, project);
        printOutput(newTrack, options, `✓ Added track "${newTrack.name}" (${newTrack.id})`);
        return;
      }
      if (subcommand === 'remove') {
        const trackId = positional[2] || options.id;
        const removed = removeTrack(project, trackId);
        await saveProject(projectDir, project);
        printOutput(removed, options, `✓ Removed track "${trackId}"`);
        return;
      }
      throw new Error(`Unknown track subcommand: "${subcommand}"`);
    }

    // ─── CLIP COMMANDS ─────────────────────────────────────────────────────
    if (command === 'clip') {
      const { project } = await loadProject(projectDir);

      if (subcommand === 'add') {
        const file = options.file;
        if (!file) throw new Error('--file is required for clip add');
        const clipRes = addVideoClip(project, {
          file,
          name: options.name,
          trackId: options.track || 'track-1',
          startTime: options.start !== undefined ? Number(options.start) : 0,
          duration: options.duration !== undefined ? Number(options.duration) : 5,
          includeAudio: options.audio !== false,
        });
        await saveProject(projectDir, project);
        printOutput(clipRes, options, `✓ Added clip "${clipRes.video.name}"`);
        return;
      }
      throw new Error(`Unknown clip subcommand: "${subcommand}"`);
    }

    // ─── ENTITY COMMANDS ───────────────────────────────────────────────────
    if (command === 'entity') {
      const { project } = await loadProject(projectDir);

      if (subcommand === 'add') {
        let props = {};
        if (options.props) {
          try {
            props = JSON.parse(options.props);
          } catch {
            props = {};
          }
        }
        const entity = addScriptEntity(project, {
          name: options.name || positional[2],
          scriptName: options.script || positional[2],
          trackId: options.track || 'track-1',
          startTime: options.start !== undefined ? Number(options.start) : 0,
          duration: options.duration !== undefined ? Number(options.duration) : 5,
          props,
        });
        await saveProject(projectDir, project);
        printOutput(entity, options, `✓ Added entity "${entity.name}" (${entity.id})`);
        return;
      }
      if (subcommand === 'remove') {
        const entityId = positional[2] || options.id;
        const rm = removeEntity(project, entityId);
        await saveProject(projectDir, project);
        printOutput(rm, options, `✓ Removed entity "${entityId}"`);
        return;
      }
      if (subcommand === 'set-prop') {
        const entityId = options.id || positional[2];
        const propArg = options.prop;
        if (!propArg || !propArg.includes('=')) {
          throw new Error('--prop <name=value> is required');
        }
        const [propName, ...valParts] = propArg.split('=');
        const valStr = valParts.join('=');
        let parsedVal = valStr;
        try {
          parsedVal = JSON.parse(valStr);
        } catch {
          // keep as string
        }
        const updatedProps = setEntityProp(project, entityId, propName, parsedVal);
        await saveProject(projectDir, project);
        printOutput(updatedProps, options, `✓ Updated prop "${propName}" on entity "${entityId}"`);
        return;
      }
      if (subcommand === 'set-transform') {
        const entityId = options.id || positional[2];
        const updates = {};
        if (options.x !== undefined) updates.x = Number(options.x);
        if (options.y !== undefined) updates.y = Number(options.y);
        if (options.scale !== undefined) {
          updates.scaleX = Number(options.scale);
          updates.scaleY = Number(options.scale);
        }
        if (options.rot !== undefined) updates.rotation = Number(options.rot);
        if (options.opacity !== undefined) updates.opacity = Number(options.opacity);

        const updated = setEntityTransform(project, entityId, updates);
        await saveProject(projectDir, project);
        printOutput(updated, options, `✓ Updated transform on entity "${entityId}"`);
        return;
      }
      throw new Error(`Unknown entity subcommand: "${subcommand}"`);
    }

    // ─── KEYFRAME COMMANDS ─────────────────────────────────────────────────
    if (command === 'keyframe') {
      const { project } = await loadProject(projectDir);

      if (subcommand === 'add') {
        const entityId = options.id || positional[2];
        const field = options.field;
        const time = options.time !== undefined ? Number(options.time) : 0;
        const value = options.value;
        const ease = options.ease || 'linear';
        const trackKey = options['track-key'] || 'Transform';

        const kf = addKeyframe(project, entityId, {
          trackKey,
          field,
          time,
          value,
          ease,
        });
        await saveProject(projectDir, project);
        printOutput(kf, options, `✓ Added keyframe for ${field} at ${time}s on entity "${entityId}"`);
        return;
      }
      if (subcommand === 'list') {
        const entityId = options.id || positional[2];
        const kfs = listKeyframes(project, entityId);
        printOutput(kfs, options);
        return;
      }
      throw new Error(`Unknown keyframe subcommand: "${subcommand}"`);
    }

    // ─── SCRIPT COMMANDS ───────────────────────────────────────────────────
    if (command === 'script') {
      if (subcommand === 'new') {
        const name = positional[2] || options.name || 'NewScript';
        const type = options.type || 'canvas';
        const script = await createScript({
          dir: projectDir,
          name,
          type,
        });
        printOutput(script, options, `✓ Created script "${script.fileName}" (${type}) at ${script.filePath}`);
        return;
      }
      if (subcommand === 'list') {
        const scripts = await listScripts(projectDir);
        printOutput(scripts, options);
        return;
      }
      if (subcommand === 'check') {
        const target = positional[2] || options.file;
        const filePath = path.resolve(projectDir, target);
        const checkRes = await validateScript(filePath);
        printOutput(checkRes, options, checkRes.valid ? `✓ Script "${target}" is valid.` : `✗ Script "${target}" has errors.`);
        return;
      }
      throw new Error(`Unknown script subcommand: "${subcommand}"`);
    }

    // ─── RENDER COMMANDS ───────────────────────────────────────────────────
    if (command === 'render') {
      const { project } = await loadProject(projectDir);

      if (subcommand === 'frame') {
        const time = options.time !== undefined ? Number(options.time) : 0;
        const evaluated = evaluateTimelineAtTime(project, time);

        if (options.out) {
          const outPath = path.resolve(options.out);
          if (outPath.endsWith('.png')) {
            const pngBuf = renderFramePng(project, time);
            await fs.writeFile(outPath, pngBuf);
            printOutput(
              { ...evaluated, out: outPath, format: 'png' },
              options,
              `✓ Frame at ${time}s rendered as PNG to ${outPath}`
            );
          } else {
            const svg = renderFrameSvg(project, time);
            await fs.writeFile(outPath, svg, 'utf8');
            printOutput(
              { ...evaluated, out: outPath },
              options,
              `✓ Frame at ${time}s rendered to ${outPath}`
            );
          }
        } else {
          printOutput(evaluated, options);
        }
        return;
      }
      if (subcommand === 'export') {
        const exportRes = await exportWithFfmpeg({
          projectDir,
          outputPath: options.out || 'output.mp4',
          quality: options.quality || 'high',
          fps: options.fps ? Number(options.fps) : 60,
        });
        printOutput(exportRes, options, `✓ Export plan created:\n  ${exportRes.command}`);
        return;
      }
      throw new Error(`Unknown render subcommand: "${subcommand}"`);
    }

    // ─── BRIDGE COMMANDS ───────────────────────────────────────────────────
    if (command === 'bridge') {
      if (subcommand === 'send') {
        const cmdType = options.cmd || positional[2];
        const arg = options.arg !== undefined ? options.arg : positional[3];
        const payload = { type: cmdType, arg };

        // Write file IPC
        await sendFileCommand(projectDir, payload);

        // Also attempt HTTP IPC if live server is running
        try {
          await sendHttpCommand(payload, options.port || 9876);
        } catch {
          // file IPC is sufficient fallback
        }

        printOutput(payload, options, `✓ Sent bridge command: ${JSON.stringify(payload)}`);
        return;
      }
      if (subcommand === 'start') {
        const port = Number(options.port || 9876);
        const bridge = await startBridgeServer({
          port,
          onCommand: (c) => console.log(`[Bridge Recv] ${JSON.stringify(c)}`),
        });
        console.log(`✓ BlahBlah Live Bridge server listening on http://127.0.0.1:${port}`);
        return;
      }
      throw new Error(`Unknown bridge subcommand: "${subcommand}"`);
    }

    throw new Error(`Unknown command "${command}". Run 'blahblah help' for usage.`);
  } catch (err) {
    if (options.json) {
      console.error(JSON.stringify({ error: err.message, stack: err.stack }));
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}
