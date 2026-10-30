import path from 'node:path';
import {
  initProject,
  loadProject,
  updateProject,
  inspectProject,
  listTracks,
  addTrack,
  removeTrack,
  requireTrack,
  validateEntityProps,
  loadScriptSchema,
  sanitizeScriptName,
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
  atomicWriteFile,
  sendFileCommand,
  sendHttpCommand,
  startBridgeServer,
  validateBridgeCommand,
  DEFAULT_BRIDGE_PORT,
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

function numberOption(options, key, fallback) {
  if (options[key] === undefined) return fallback;
  const n = Number(options[key]);
  if (options[key] === true || !Number.isFinite(n)) {
    throw new Error(`--${key} must be a number (got ${JSON.stringify(options[key])}).`);
  }
  return n;
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

  blahblah script new <name> [--type <canvas|motion|react|codesnippet>] [--force] [--dir <path>] [--json]
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
      if (subcommand === 'list') {
        const { project } = await loadProject(projectDir);
        const tracks = listTracks(project);
        printOutput(tracks, options);
        return;
      }
      if (subcommand === 'add') {
        const name = positional[2] || options.name;
        const newTrack = await updateProject(projectDir, (project) => addTrack(project, { name, id: options.id }));
        printOutput(newTrack, options, `✓ Added track "${newTrack.name}" (${newTrack.id})`);
        return;
      }
      if (subcommand === 'remove') {
        const trackId = positional[2] || options.id;
        const removed = await updateProject(projectDir, (project) => removeTrack(project, trackId));
        printOutput(removed, options, `✓ Removed track "${trackId}"`);
        return;
      }
      throw new Error(`Unknown track subcommand: "${subcommand}"`);
    }

    // ─── CLIP COMMANDS ─────────────────────────────────────────────────────
    if (command === 'clip') {
      if (subcommand === 'add') {
        const file = options.file;
        if (!file || file === true) throw new Error('--file is required for clip add');
        const startTime = numberOption(options, 'start', 0);
        const duration = numberOption(options, 'duration', 5);
        const clipRes = await updateProject(projectDir, (project) => {
          const trackId = options.track || 'track-1';
          requireTrack(project, trackId);
          return addVideoClip(project, {
            file,
            name: options.name,
            trackId,
            startTime,
            duration,
            includeAudio: options.audio !== false,
          });
        });
        printOutput(clipRes, options, `✓ Added clip "${clipRes.video.name}"`);
        return;
      }
      throw new Error(`Unknown clip subcommand: "${subcommand}"`);
    }

    // ─── ENTITY COMMANDS ───────────────────────────────────────────────────
    if (command === 'entity') {
      if (subcommand === 'add') {
        let props = {};
        if (options.props) {
          try {
            props = JSON.parse(options.props);
          } catch (err) {
            throw new Error(`--props must be valid JSON: ${err.message}`);
          }
          if (!props || typeof props !== 'object' || Array.isArray(props)) {
            throw new Error('--props must be a JSON object, e.g. \'{"title":"Hi"}\'.');
          }
        }
        const scriptName = options.script || positional[2];
        const startTime = numberOption(options, 'start', 0);
        const duration = numberOption(options, 'duration', 5);

        // If the script exists, check the props against what it declares.
        // (A script that does not exist yet is allowed so it can be written afterwards.)
        const schema = scriptName ? await loadScriptSchema(projectDir, scriptName) : null;
        if (schema) {
          const propErrors = validateEntityProps(schema, props);
          if (propErrors.length > 0) throw new Error(`Invalid props:\n${propErrors.join('\n')}`);
        } else if (scriptName) {
          console.error(`Warning: script "${sanitizeScriptName(scriptName)}" was not found in scripts/ (create it with 'blahblah script new').`);
        }

        const entity = await updateProject(projectDir, (project) => {
          const trackId = options.track || 'track-1';
          requireTrack(project, trackId);
          return addScriptEntity(project, {
            name: options.name || positional[2],
            scriptName,
            trackId,
            startTime,
            duration,
            props,
          });
        });
        printOutput(entity, options, `✓ Added entity "${entity.name}" (${entity.id})`);
        return;
      }
      if (subcommand === 'remove') {
        const entityId = positional[2] || options.id;
        const rm = await updateProject(projectDir, (project) => removeEntity(project, entityId));
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
        const { project: current } = await loadProject(projectDir);
        const target = findEntity(current, entityId);
        if (!target) throw new Error(`Entity "${entityId}" not found.`);
        const scriptComp = (target.components || []).find((c) => c.type === 'ScriptComponent');
        const schema = scriptComp?.scriptName ? await loadScriptSchema(projectDir, scriptComp.scriptName) : null;
        const updatedProps = await updateProject(projectDir, (project) =>
          setEntityProp(project, target.id, propName, parsedVal, { schema })
        );
        printOutput(updatedProps, options, `✓ Updated prop "${propName}" on entity "${entityId}"`);
        return;
      }
      if (subcommand === 'set-transform') {
        const entityId = options.id || positional[2];
        const updates = {};
        if (options.x !== undefined) updates.x = numberOption(options, 'x');
        if (options.y !== undefined) updates.y = numberOption(options, 'y');
        if (options.scale !== undefined) {
          updates.scaleX = numberOption(options, 'scale');
          updates.scaleY = updates.scaleX;
        }
        if (options.rot !== undefined) updates.rotation = numberOption(options, 'rot');
        if (options.opacity !== undefined) updates.opacity = numberOption(options, 'opacity');
        if (Object.keys(updates).length === 0) {
          throw new Error('Give at least one of --x, --y, --scale, --rot, --opacity.');
        }

        const updated = await updateProject(projectDir, (project) => setEntityTransform(project, entityId, updates));
        printOutput(updated, options, `✓ Updated transform on entity "${entityId}"`);
        return;
      }
      throw new Error(`Unknown entity subcommand: "${subcommand}"`);
    }

    // ─── KEYFRAME COMMANDS ─────────────────────────────────────────────────
    if (command === 'keyframe') {
      if (subcommand === 'add') {
        const entityId = options.id || positional[2];
        const field = options.field;
        const time = numberOption(options, 'time', 0);
        const value = options.value;
        const ease = options.ease || 'linear';
        const trackKey = options['track-key'] || 'Transform';

        const kf = await updateProject(projectDir, (project) =>
          addKeyframe(project, entityId, { trackKey, field, time, value, ease })
        );
        printOutput(kf, options, `✓ Added keyframe for ${field} at ${time}s on entity "${entityId}"`);
        return;
      }
      if (subcommand === 'list') {
        const { project } = await loadProject(projectDir);
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
          overwrite: options.force === true,
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
        if (!target || target === true) throw new Error('Give the script file to check: blahblah script check <file>');
        const filePath = path.resolve(projectDir, target);
        // The user runs the CLI on their own machine, so any path is allowed here.
        const checkRes = await validateScript(filePath, { unrestricted: true });
        printOutput(checkRes, options, checkRes.valid ? `✓ Script "${target}" is valid.` : `✗ Script "${target}" has errors.`);
        if (!checkRes.valid) process.exitCode = 1;
        return;
      }
      throw new Error(`Unknown script subcommand: "${subcommand}"`);
    }

    // ─── RENDER COMMANDS ───────────────────────────────────────────────────
    if (command === 'render') {
      const { project } = await loadProject(projectDir);

      if (subcommand === 'frame') {
        const time = numberOption(options, 'time', 0);
        const evaluated = evaluateTimelineAtTime(project, time);

        if (options.out) {
          const outPath = path.resolve(options.out);
          if (/\.png$/i.test(outPath)) {
            const pngBuf = renderFramePng(project, time);
            await atomicWriteFile(outPath, pngBuf);
            printOutput(
              { ...evaluated, out: outPath, format: 'png' },
              options,
              `✓ Frame at ${time}s rendered as PNG to ${outPath}`
            );
          } else {
            const svg = renderFrameSvg(project, time);
            await atomicWriteFile(outPath, svg);
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
          fps: numberOption(options, 'fps', 60),
        });
        printOutput(
          exportRes,
          options,
          `✓ Export plan created (plan only: this command renders a black placeholder, not the timeline):\n  ${exportRes.command}`
        );
        return;
      }
      throw new Error(`Unknown render subcommand: "${subcommand}"`);
    }

    // ─── BRIDGE COMMANDS ───────────────────────────────────────────────────
    if (command === 'bridge') {
      if (subcommand === 'send') {
        const cmdType = options.cmd || positional[2];
        const arg = options.arg !== undefined ? options.arg : positional[3];
        const payload = validateBridgeCommand({ type: cmdType, arg });

        // Write file IPC
        const queued = await sendFileCommand(projectDir, payload);

        // Also attempt HTTP IPC if live server is running
        let delivered = false;
        try {
          const res = await sendHttpCommand(payload, options.port || DEFAULT_BRIDGE_PORT, { projectDir });
          delivered = Boolean(res.delivered);
        } catch {
          // file IPC is the fallback
        }

        printOutput(
          { ...queued, delivered },
          options,
          delivered
            ? `✓ Bridge command delivered: ${JSON.stringify(payload)}`
            : `✓ Bridge command queued (no running editor acknowledged it yet): ${JSON.stringify(payload)}`
        );
        return;
      }
      if (subcommand === 'start') {
        const port = Number(options.port || DEFAULT_BRIDGE_PORT);
        const bridge = await startBridgeServer({
          port,
          projectDir,
          onCommand: (c) => console.log(`[Bridge Recv] ${JSON.stringify(c)}`),
        });
        console.log(`✓ BlahBlah Live Bridge server listening on http://127.0.0.1:${bridge.port}`);
        console.log(`  Token (also saved to ${path.join(projectDir, '.aibridge', 'token')}): ${bridge.token}`);
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