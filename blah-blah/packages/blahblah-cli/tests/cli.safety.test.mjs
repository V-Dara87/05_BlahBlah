import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { runCli } from '../src/cli.js';

// runCli calls process.exit(1) on errors; turn that into a catchable failure.
async function failing(args) {
  const realExit = process.exit;
  const realError = console.error;
  const messages = [];
  process.exit = (code) => {
    throw new Error(`exit:${code}`);
  };
  console.error = (m) => messages.push(String(m));
  try {
    await runCli(args);
    return null;
  } catch (err) {
    assert.equal(err.message, 'exit:1');
    return messages.join('\n');
  } finally {
    process.exit = realExit;
    console.error = realError;
  }
}

test('CLI - bad input fails loudly and nothing is overwritten', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blahblah-cli-safe-'));
  const log = console.log;
  console.log = () => {};
  try {
    await runCli(['project', 'init', 'Keep', '--dir', dir]);
    assert.match(await failing(['project', 'init', 'Again', '--dir', dir]), /already exists/);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8')).name, 'Keep');

    await runCli(['script', 'new', 'Mine', '--dir', dir]);
    const file = path.join(dir, 'scripts', 'Mine.jsx');
    await fs.writeFile(file, 'export default class Mine {} // mine');
    assert.match(await failing(['script', 'new', 'Mine', '--dir', dir]), /already exists/);
    assert.match(await fs.readFile(file, 'utf8'), /mine/);

    assert.match(await failing(['entity', 'add', '--name', 'X', '--script', 'Mine', '--props', '{oops', '--dir', dir]), /valid JSON/);
    assert.match(await failing(['entity', 'add', '--name', 'X', '--script', 'Mine', '--start', 'soon', '--dir', dir]), /--start must be a number/);
    assert.match(await failing(['clip', 'add', '--file', 'media/a.mp4', '--track', 'track-99', '--dir', dir]), /Track "track-99" not found/);
    assert.match(await failing(['bridge', 'send', '--cmd', 'explode', '--dir', dir]), /Unknown bridge command/);
    assert.match(await failing(['script', 'check', '--dir', dir]), /Give the script file/);

    const project = JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8'));
    assert.equal(project.entities.length, 0);
  } finally {
    console.log = log;
    await fs.rm(dir, { recursive: true, force: true });
  }
});