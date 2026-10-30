import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import readline from 'node:readline';
import { PassThrough } from 'node:stream';

import { handleToolCall, startMcpServer, TOOLS } from '../src/server.js';

test('MCP - Tools definition and tool call execution', async () => {
  assert.ok(TOOLS.length >= 10, 'Should register at least 10 MCP tools');
  process.env.BLAHBLAH_BRIDGE_PORT = '1'; // nothing listens there: live_control must report "queued"
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blahblah-mcp-test-'));

  try {
    // 1. init
    const initRes = await handleToolCall('blahblah_project_init', {
      dir: tmpDir,
      name: 'MCP Automation Project',
      resolution: 'reels',
    });
    assert.equal(initRes.project.name, 'MCP Automation Project');
    assert.equal(initRes.project.resolution.width, 1080);
    assert.equal(initRes.project.resolution.height, 1920);

    // 2. add track
    const trackRes = await handleToolCall('blahblah_track_add', {
      dir: tmpDir,
      name: 'Subtitles',
    });
    assert.equal(trackRes.name, 'Subtitles');

    // 3. add clip
    const clipRes = await handleToolCall('blahblah_clip_add', {
      dir: tmpDir,
      file: 'media/video.mp4',
      name: 'Main Video',
      startTime: 0,
      duration: 10,
    });
    assert.ok(clipRes.video);

    // 4. create script
    const scriptRes = await handleToolCall('blahblah_script_create', {
      dir: tmpDir,
      name: 'CounterOverlay',
      type: 'canvas',
    });
    assert.equal(scriptRes.name, 'CounterOverlay');

    // 5. validate script
    const valRes = await handleToolCall('blahblah_script_validate', {
      filePath: scriptRes.filePath,
    });
    assert.equal(valRes.valid, true);

    // 6. add entity
    const entityRes = await handleToolCall('blahblah_entity_add', {
      dir: tmpDir,
      name: 'Score Counter',
      scriptName: 'CounterOverlay',
      trackId: 'track-2',
      startTime: 1,
      duration: 5,
      props: { size: 80 },
    });
    assert.ok(entityRes.id);
    assert.equal(entityRes.components.find((c) => c.type === 'ScriptComponent').props.size, 80);

    // 7. set prop
    const propRes = await handleToolCall('blahblah_entity_set_prop', {
      dir: tmpDir,
      entityId: entityRes.id,
      propName: 'size',
      propValue: 42,
    });
    assert.equal(propRes.updatedProps.size, 42);

    // 8. set transform
    const transRes = await handleToolCall('blahblah_entity_set_transform', {
      dir: tmpDir,
      entityId: entityRes.id,
      x: 50,
      y: -100,
      opacity: 0.9,
    });
    assert.equal(transRes.transform.x, 50);

    // 9. add keyframe
    const kfRes = await handleToolCall('blahblah_keyframe_add', {
      dir: tmpDir,
      entityId: entityRes.id,
      field: 'x',
      time: 2,
      value: 200,
      ease: 'bounce',
    });
    assert.ok(kfRes.id);

    // 10. render frame
    const svgPath = path.join(tmpDir, 'frame.svg');
    const renderRes = await handleToolCall('blahblah_render_frame', {
      dir: tmpDir,
      time: 2.0,
      outFile: svgPath,
    });
    assert.ok(renderRes.activeEntitiesCount > 0);
    assert.ok(await fs.stat(svgPath));

    // 10b. render frame PNG
    const pngRes = await handleToolCall('blahblah_render_frame', {
      dir: tmpDir,
      time: 2.0,
      format: 'png',
    });
    assert.ok(pngRes.pngBase64, 'should return base64 PNG');
    assert.ok(pngRes.pngBase64.length > 100, 'base64 should be non-trivial size');
    assert.equal(pngRes.format, 'png');
    assert.equal(pngRes.fidelity, 'schematic');

    // 11. inspect project
    const inspectRes = await handleToolCall('blahblah_project_inspect', { dir: tmpDir });
    assert.equal(inspectRes.entitiesCount, 3);
    assert.equal(inspectRes.resolution.height, 1920);

    // 12. live control
    const controlRes = await handleToolCall('blahblah_live_control', {
      dir: tmpDir,
      command: 'seek',
      arg: 3.5,
    });
    assert.equal(controlRes.status, 'queued', 'with no editor running the command is only queued');
    assert.equal(controlRes.delivered, false);
    assert.match(controlRes.note, /no running BlahBlah editor/);
    assert.ok(await fs.stat(path.join(tmpDir, '.aibridge', 'inbox')));

    // 13. create codesnippet script
    const csRes = await handleToolCall('blahblah_script_create', {
      dir: tmpDir,
      name: 'CodeDemo',
      type: 'codesnippet',
    });
    assert.equal(csRes.name, 'CodeDemo');
    assert.ok(csRes.code.includes('typewriterSpeed'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

async function freshProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blahblah-mcp-test-'));
  await handleToolCall('blahblah_project_init', { dir, name: 'P' });
  return dir;
}

test('MCP - input is checked before anything is written', async () => {
  const dir = await freshProject();
  try {
    await handleToolCall('blahblah_script_create', { dir, name: 'Box', type: 'canvas' });

    // script must exist, props must match its declaration
    await assert.rejects(
      () => handleToolCall('blahblah_entity_add', { dir, name: 'x', scriptName: 'Missing' }),
      /not found in scripts/
    );
    await assert.rejects(
      () => handleToolCall('blahblah_entity_add', { dir, name: 'x', scriptName: 'Box', props: { nope: 1 } }),
      /Unknown prop "nope"/
    );
    await assert.rejects(
      () => handleToolCall('blahblah_entity_add', { dir, name: 'x', scriptName: 'Box', trackId: 'track-99' }),
      /Track "track-99" not found/
    );
    await assert.rejects(
      () => handleToolCall('blahblah_entity_add', { dir, name: 'x', scriptName: 'Box', duration: 0 }),
      /duration must be/
    );

    const ok = await handleToolCall('blahblah_entity_add', { dir, name: 'Good', scriptName: 'Box', props: { size: 60 } });
    await assert.rejects(
      () => handleToolCall('blahblah_entity_set_prop', { dir, entityId: ok.id, propName: 'size', propValue: 9999 }),
      /<= 200/
    );
    await assert.rejects(
      () => handleToolCall('blahblah_entity_set_prop', { dir, entityId: ok.id, propName: 'color', propValue: 12 }),
      /expects a color/
    );
    await assert.rejects(
      () => handleToolCall('blahblah_entity_set_transform', { dir, entityId: ok.id, opacity: 3 }),
      /between 0 and 1/
    );

    // nothing above changed the project
    const inspected = await handleToolCall('blahblah_project_inspect', { dir });
    assert.equal(inspected.entitiesCount, 1);
    assert.equal(
      (await handleToolCall('blahblah_script_read', { dir, name: 'Box' })).props.length,
      3
    );

    // media paths must stay inside the project
    await assert.rejects(() => handleToolCall('blahblah_clip_add', { dir, file: '../../etc/passwd' }), /inside the project/);
    await assert.rejects(() => handleToolCall('blahblah_clip_add', { dir, file: '/etc/passwd' }), /relative/);

    // `dir` is mandatory: no silent fallback to the current directory
    await assert.rejects(() => handleToolCall('blahblah_project_inspect', {}), /project directory \("dir"\) is required/);
    await assert.rejects(() => handleToolCall('blahblah_project_init', { dir }), /already exists/);
    await assert.rejects(() => handleToolCall('blahblah_does_not_exist', { dir }), /Unknown tool/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('MCP - an AI can write, check, list, read and replace scripts', async () => {
  const dir = await freshProject();
  try {
    const code = `import { CanvasComponent } from '@blahblah/sdk';
export default class Title extends CanvasComponent {
  static props = { text: { type: 'string', default: 'Hi' }, size: { type: 'number', default: 30, min: 5, max: 90 } };
  onUpdate({ props }) { this.ctx?.fillText(props.text, 0, 0); }
}
`;
    const written = await handleToolCall('blahblah_script_write', { dir, name: 'Title', code });
    assert.equal(written.validation.valid, true);

    await assert.rejects(() => handleToolCall('blahblah_script_write', { dir, name: 'Title', code }), /already exists/);

    const bad = code.replace('props.text, 0, 0);', 'props.text, 0, 0;');
    await assert.rejects(
      () => handleToolCall('blahblah_script_write', { dir, name: 'Title', code: bad, overwrite: true }),
      /NOT written.*Line \d+/s
    );
    assert.equal((await handleToolCall('blahblah_script_read', { dir, name: 'Title' })).code, code);

    const listed = await handleToolCall('blahblah_script_list', { dir });
    assert.deepEqual(listed.map((s) => [s.name, s.kind, s.props]), [['Title', 'canvas', ['text', 'size']]]);

    assert.equal((await handleToolCall('blahblah_script_validate', { dir, name: 'Title' })).valid, true);
    assert.equal((await handleToolCall('blahblah_script_validate', { code: bad })).valid, false);
    await assert.rejects(() => handleToolCall('blahblah_script_validate', {}), /Give `code`/);

    // validate cannot be used to read arbitrary files
    const secret = path.join(dir, 'secret.js');
    await fs.writeFile(secret, 'export default 1;');
    await assert.rejects(() => handleToolCall('blahblah_script_validate', { filePath: secret }), /scripts/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('MCP - keyframes and tracks can be listed and removed', async () => {
  const dir = await freshProject();
  try {
    await handleToolCall('blahblah_script_create', { dir, name: 'Box' });
    const e = await handleToolCall('blahblah_entity_add', { dir, name: 'Box', scriptName: 'Box' });
    const k1 = await handleToolCall('blahblah_keyframe_add', { dir, entityId: e.id, field: 'x', time: 0, value: 0 });
    await handleToolCall('blahblah_keyframe_add', { dir, entityId: e.id, field: 'x', time: 2, value: 100, ease: 'easeOut' });

    const listed = await handleToolCall('blahblah_keyframe_list', { dir, entityId: e.id });
    assert.equal(listed.Transform.x.length, 2);
    assert.equal((await handleToolCall('blahblah_keyframe_remove', { dir, entityId: e.id, keyframeIds: [k1.id] })).removedCount, 1);

    const tracksBefore = await handleToolCall('blahblah_track_list', { dir });
    const removed = await handleToolCall('blahblah_track_remove', { dir, trackId: 'track-1' });
    assert.equal(removed.removedEntities, 1);
    assert.equal((await handleToolCall('blahblah_track_list', { dir })).length, tracksBefore.length - 1);

    await handleToolCall('blahblah_audio_add', { dir, file: 'media/a.wav', trackId: 'track-3', duration: 3 });
    assert.equal((await handleToolCall('blahblah_project_inspect', { dir })).entitiesCount, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('MCP - parallel tool calls on one project lose no edits', async () => {
  const dir = await freshProject();
  try {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => handleToolCall('blahblah_track_add', { dir, name: `Parallel ${i}` }))
    );
    assert.equal((await handleToolCall('blahblah_track_list', { dir })).length, 4 + 12);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('MCP - render_frame stays inside the project and honours the extension', async () => {
  const dir = await freshProject();
  try {
    await assert.rejects(
      () => handleToolCall('blahblah_render_frame', { dir, time: 0, outFile: '../escape.svg' }),
      /inside the project/
    );
    await assert.rejects(
      () => handleToolCall('blahblah_render_frame', { dir, time: 0, outFile: 'frame.txt' }),
      /must end with/
    );
    await assert.rejects(() => handleToolCall('blahblah_render_frame', { dir, time: -1 }), /time/);

    // an upper-case extension used to write SVG text into a .PNG file
    const res = await handleToolCall('blahblah_render_frame', { dir, time: 0, outFile: 'frame.PNG' });
    assert.equal(res.format, 'png');
    const bytes = await fs.readFile(path.join(dir, 'frame.PNG'));
    assert.deepEqual([...bytes.subarray(0, 4)], [137, 80, 78, 71]);

    const plan = await handleToolCall('blahblah_export_plan', { dir });
    assert.equal(plan.planOnly, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('MCP - stdio protocol: ping, errors as isError, images, annotations, bad input', async () => {
  const dir = await freshProject();
  const input = new PassThrough();
  const output = new PassThrough();
  const rl = startMcpServer({ input, output });

  const lines = [];
  const waiters = new Map();
  readline.createInterface({ input: output }).on('line', (line) => {
    const msg = JSON.parse(line);
    lines.push(msg);
    waiters.get(msg.id)?.(msg);
  });
  const call = (message) =>
    new Promise((resolve) => {
      waiters.set(message.id, resolve);
      input.write(JSON.stringify(message) + '\n');
    });

  try {
    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    assert.equal(init.result.protocolVersion, '2025-03-26');
    assert.equal((await call({ jsonrpc: '2.0', id: 2, method: 'ping' })).result !== undefined, true);

    const list = await call({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const byName = Object.fromEntries(list.result.tools.map((t) => [t.name, t]));
    assert.equal(byName.blahblah_project_inspect.annotations.readOnlyHint, true);
    assert.equal(byName.blahblah_entity_remove.annotations.destructiveHint, true);
    assert.ok(list.result.tools.every((t) => t.annotations && t.inputSchema));

    // a failing tool is reported as a result with isError, not as a protocol error
    const failed = await call({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'blahblah_entity_add', arguments: { dir, name: 'x', scriptName: 'Missing' } },
    });
    assert.equal(failed.error, undefined);
    assert.equal(failed.result.isError, true);
    assert.match(failed.result.content[0].text, /not found in scripts/);

    // unknown tool = invalid params
    const unknown = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } });
    assert.equal(unknown.error.code, -32602);

    // PNG comes back as an image block, not as base64 inside the JSON text
    const png = await call({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'blahblah_render_frame', arguments: { dir, time: 0, format: 'png' } },
    });
    const image = png.result.content.find((c) => c.type === 'image');
    assert.equal(image.mimeType, 'image/png');
    assert.ok(image.data.length > 100);
    assert.ok(!png.result.content.find((c) => c.type === 'text').text.includes(image.data.slice(0, 40)));

    // garbage on the wire gets a parse error instead of silence
    const parse = new Promise((resolve) => waiters.set(null, resolve));
    input.write('{not json\n');
    assert.equal((await parse).error.code, -32700);

    // notifications get no response
    const before = lines.length;
    input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(lines.length, before);
  } finally {
    rl.close();
    input.end();
    await fs.rm(dir, { recursive: true, force: true });
  }
});


test('MCP - render_frame supports source "editor" and "schematic"', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blahblah-mcp-render-'));
  try {
    await handleToolCall('blahblah_project_init', { dir, name: 'RenderTest' });

    // 1. Explicit schematic
    const schematicRes = await handleToolCall('blahblah_render_frame', {
      dir,
      time: 0,
      source: 'schematic',
      format: 'png',
    });
    assert.equal(schematicRes.fidelity, 'schematic');
    assert.ok(schematicRes.pngBase64);

    // 2. Editor source simulated: a background mock editor watches .aibridge/inbox and answers render_frame
    const inboxDir = path.join(dir, '.aibridge', 'inbox');
    const outboxDir = path.join(dir, '.aibridge', 'outbox');
    await fs.mkdir(inboxDir, { recursive: true });
    await fs.mkdir(outboxDir, { recursive: true });

    let stopped = false;
    const mockEditor = (async () => {
      while (!stopped) {
        try {
          const files = (await fs.readdir(inboxDir)).filter((f) => f.endsWith('.json'));
          for (const f of files) {
            const raw = await fs.readFile(path.join(inboxDir, f), 'utf8');
            const cmd = JSON.parse(raw);
            if (cmd.type === 'render_frame') {
              const dummyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
              await fs.writeFile(path.join(outboxDir, `${cmd.id}.png`), dummyPng);
              await fs.writeFile(
                path.join(outboxDir, `${cmd.id}.json`),
                JSON.stringify({
                  id: cmd.id,
                  ok: true,
                  fidelity: 'editor',
                  format: 'png',
                  width: 1280,
                  height: 720,
                  pngBase64: dummyPng.toString('base64'),
                })
              );
              await fs.rm(path.join(inboxDir, f));
            }
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 20));
      }
    })();

    try {
      const editorRes = await handleToolCall('blahblah_render_frame', {
        dir,
        time: 1.0,
        source: 'editor',
        timeoutMs: 2000,
      });
      assert.equal(editorRes.fidelity, 'editor');
      assert.equal(editorRes.width, 1280);
      assert.equal(editorRes.height, 720);
      assert.ok(editorRes.pngBase64);
      assert.match(editorRes.note, /Real composited frame/);
    } finally {
      stopped = true;
      await mockEditor;
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
