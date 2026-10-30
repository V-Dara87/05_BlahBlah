import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';

import {
  sendFileCommand,
  pollFileCommand,
  writeFileResult,
  waitForResult,
  sendHttpCommand,
  startBridgeServer,
  validateBridgeCommand,
  DEFAULT_ALLOWED_ORIGINS,
} from '../src/index.js';

function request(port, { headers = {}, method = 'GET', url = '/status', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('commands are validated', () => {
  assert.deepEqual(validateBridgeCommand({ type: 'seek', arg: '2.5' }), { type: 'seek', arg: 2.5 });
  assert.throws(() => validateBridgeCommand({ type: 'seek', arg: -1 }), /seek/);
  assert.throws(() => validateBridgeCommand({ type: 'format-disk' }), /Unknown bridge command/);
  assert.throws(() => validateBridgeCommand({ type: 'select' }), /select/);
  assert.deepEqual(validateBridgeCommand({ type: 'play', arg: 'ignored' }), { type: 'play' });
  assert.deepEqual(validateBridgeCommand({ type: 'render_frame', arg: { time: 3.5, format: 'png' } }), {
    type: 'render_frame',
    arg: { time: 3.5, format: 'png' },
  });
  assert.deepEqual(validateBridgeCommand({ type: 'render_frame', arg: 2 }), {
    type: 'render_frame',
    arg: { time: 2, format: 'png' },
  });
  assert.throws(() => validateBridgeCommand({ type: 'render_frame', arg: -1 }), /render_frame/);
  assert.throws(() => validateBridgeCommand({ type: 'render_frame', arg: { time: 1, format: 'bmp' } }), /only supports format "png"/);
});

test('file bridge keeps every command in order and supports results', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-bridge-'));
  try {
    const first = await sendFileCommand(dir, { type: 'seek', arg: 1 });
    const second = await sendFileCommand(dir, { type: 'pause' });

    assert.equal((await pollFileCommand(dir, { consume: true })).id, first.id);
    assert.equal((await pollFileCommand(dir, { consume: true })).id, second.id);
    assert.equal(await pollFileCommand(dir), null);

    assert.equal(await waitForResult(dir, first.id, { timeoutMs: 120, intervalMs: 20 }), null);
    setTimeout(() => writeFileResult(dir, first.id, { ok: true, time: 1 }), 60);
    const result = await waitForResult(dir, first.id, { timeoutMs: 2000, intervalMs: 20 });
    assert.equal(result.ok, true);

    await assert.rejects(() => waitForResult(dir, '../etc/passwd'), /Invalid command id/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('HTTP bridge requires the token, refuses foreign origins and hosts, and reports delivery', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-http-'));
  const bridge = await startBridgeServer({ port: 0, projectDir: dir, allowedOrigins: ['tauri://localhost'] });
  try {
    assert.equal((await fs.readFile(path.join(dir, '.aibridge', 'token'), 'utf8')).trim(), bridge.token);

    // no token
    assert.equal((await request(bridge.port)).status, 401);
    // browser page from another site, even with the token
    const evil = await request(bridge.port, {
      headers: { Origin: 'https://evil.example', Authorization: `Bearer ${bridge.token}` },
    });
    assert.equal(evil.status, 403);
    // DNS-rebinding style Host header
    const rebound = await request(bridge.port, {
      headers: { Host: 'evil.example', Authorization: `Bearer ${bridge.token}` },
    });
    assert.equal(rebound.status, 403);
    // allowed origin gets CORS + works
    const app = await request(bridge.port, {
      headers: { Origin: 'tauri://localhost', Authorization: `Bearer ${bridge.token}` },
    });
    assert.equal(app.status, 200);

    // nobody listening yet
    const lonely = await sendHttpCommand({ type: 'play' }, bridge.port, { projectDir: dir });
    assert.equal(lonely.ok, true);
    assert.equal(lonely.delivered, false);

    const seen = [];
    const off = bridge.on((c) => seen.push(c));
    const delivered = await sendHttpCommand({ type: 'seek', arg: 4 }, bridge.port, { projectDir: dir });
    assert.equal(delivered.delivered, true);
    assert.equal(seen[0].arg, 4);
    off();

    await assert.rejects(
      () => sendHttpCommand({ type: 'play' }, bridge.port, { token: 'wrong' }),
      /HTTP 401/
    );
    const badBody = await request(bridge.port, {
      method: 'POST',
      url: '/command',
      headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'rm -rf' }),
    });
    assert.equal(badBody.status, 400);
  } finally {
    await bridge.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('sendHttpCommand gives up instead of hanging when nothing answers', async () => {
  const silent = http.createServer(() => {
    /* never answers */
  });
  await new Promise((r) => silent.listen(0, '127.0.0.1', r));
  try {
    const started = Date.now();
    await assert.rejects(
      () => sendHttpCommand({ type: 'play' }, silent.address().port, { token: 't', timeoutMs: 150 }),
      /no answer/
    );
    assert.ok(Date.now() - started < 2000);
  } finally {
    silent.closeAllConnections?.();
    await new Promise((r) => silent.close(r));
  }
});

test('sendFileCommand includes token when present and server uses DEFAULT_ALLOWED_ORIGINS', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-tok-'));
  await fs.mkdir(path.join(dir, '.aibridge'), { recursive: true });
  await fs.writeFile(path.join(dir, '.aibridge', 'token'), 'secret123');
  const bridge = await startBridgeServer({ port: 0, projectDir: dir });

  try {
    const cmd = await sendFileCommand(dir, { type: 'render_frame', arg: { time: 1.5, format: 'png' } });
    assert.equal(cmd.token, bridge.token);
    assert.deepEqual(DEFAULT_ALLOWED_ORIGINS, ['tauri://localhost', 'http://tauri.localhost', 'http://localhost:5173']);

    // dev origin http://localhost:5173 is allowed by default
    const res = await request(bridge.port, {
      headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${bridge.token}` },
    });
    assert.equal(res.status, 200);
  } finally {
    await bridge.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
