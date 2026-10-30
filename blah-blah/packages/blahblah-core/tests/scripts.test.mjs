import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  initProject,
  createScript,
  writeScript,
  readScript,
  listScripts,
  validateScript,
  extractScriptPropsSchema,
  validateEntityProps,
  loadScriptSchema,
  sanitizeScriptName,
  SCRIPT_TEMPLATES,
  ScriptValidationError,
} from '../src/index.js';

async function project() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-scripts-'));
  await initProject({ dir, name: 'Scripts' });
  return dir;
}

test('every script template produces a script that validates (codesnippet used to be broken)', async () => {
  for (const type of Object.keys(SCRIPT_TEMPLATES)) {
    const result = await validateScript(SCRIPT_TEMPLATES[type]('Sample'));
    assert.equal(result.valid, true, `${type}: ${result.errors.join('; ')}`);
  }
});

test('validateScript: braces in strings/comments are fine, real errors have a line', async () => {
  const fine = `import { CanvasComponent } from '@blahblah/sdk';
// } ( [ in a comment
export default class A extends CanvasComponent {
  static props = { label: { type: 'string', default: 'a { b ( c' } };
  onUpdate() { const s = "}}}"; const t = \`\${1}{\`; return /[}]/.test(s + t); }
}
`;
  const ok = await validateScript(fine);
  assert.equal(ok.valid, true, ok.errors.join('; '));

  const broken = 'export default class A {\n  m() {\n    return (1;\n  }\n}\n';
  const bad = await validateScript(broken);
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => /^Line \d+:\d+/.test(e)), bad.errors.join('; '));
  assert.ok(bad.diagnostics.every((d) => Number.isInteger(d.line)));

  const noDefault = await validateScript('// export default nothing\nconst a = 1;\n');
  assert.equal(noDefault.valid, false);
  assert.match(noDefault.errors[0], /export default/);

  if (bad.engine === 'esbuild') {
    const typo = await validateScript('export default class A { m() { const = 5; } }');
    assert.equal(typo.valid, false, 'a real parser must catch what bracket counting cannot');
  }
});

test('validateScript only reads files inside a scripts folder', async () => {
  const dir = await project();
  try {
    const secret = path.join(dir, 'secret.js');
    await fs.writeFile(secret, 'export default 1;');
    await assert.rejects(() => validateScript(secret), /scripts/);
    await assert.rejects(() => validateScript(secret, { baseDir: dir }), /scripts/);

    const created = await createScript({ dir, name: 'Ok', type: 'canvas' });
    assert.equal((await validateScript(created.filePath, { baseDir: dir })).valid, true);
    assert.equal((await validateScript(created.filePath)).valid, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('createScript never replaces an existing script silently', async () => {
  const dir = await project();
  try {
    const first = await createScript({ dir, name: 'Mine', type: 'canvas' });
    await fs.writeFile(first.filePath, 'export default class Mine {}\n// my work');

    await assert.rejects(() => createScript({ dir, name: 'Mine' }), /already exists/);
    assert.match(await fs.readFile(first.filePath, 'utf8'), /my work/);

    await createScript({ dir, name: 'Mine', overwrite: true });
    assert.match(await fs.readFile(`${first.filePath}.bak`, 'utf8'), /my work/);

    assert.equal(sanitizeScriptName('Foo.jsx'), 'Foo');
    assert.throws(() => sanitizeScriptName('!!!'), /not a usable script name/);
    assert.throws(() => sanitizeScriptName('9lives'), /must start with a letter/);
    await assert.rejects(() => createScript({ dir, name: 'X', type: 'nope' }), /Unknown script type/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('writeScript validates first, refuses silent overwrites and keeps a backup', async () => {
  const dir = await project();
  try {
    const good = SCRIPT_TEMPLATES.canvas('Banner').replace("default: 40", "default: 64");
    const written = await writeScript({ dir, name: 'Banner', code: good });
    assert.equal(written.replaced, false);
    assert.equal((await readScript(dir, 'Banner')).props.find((p) => p.name === 'size').default, 64);

    await assert.rejects(() => writeScript({ dir, name: 'Banner', code: good }), /already exists/);

    const bad = 'export default class Banner { m() { return (; } }';
    await assert.rejects(
      () => writeScript({ dir, name: 'Banner', code: bad, overwrite: true }),
      (err) => err instanceof ScriptValidationError && err.diagnostics.length > 0 && /NOT written/.test(err.message)
    );
    assert.equal(await fs.readFile(written.filePath, 'utf8'), good, 'invalid code must not touch the file');

    const replaced = await writeScript({ dir, name: 'Banner', code: good + '\n// v2', overwrite: true });
    assert.equal(replaced.replaced, true);
    assert.equal(await fs.readFile(`${written.filePath}.bak`, 'utf8'), good);

    assert.deepEqual((await listScripts(dir)).map((s) => s.name), ['Banner']);
    await assert.rejects(() => writeScript({ dir, name: 'Empty', code: '  ' }), /code is required/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('props schema is read as data (never executed) and checks values', async () => {
  const code = `
    export default class P extends CanvasComponent {
      static props = {
        size: { type: 'number', default: 40, min: 10, max: 200 },
        mode: { type: 'select', options: ['a', 'b'], default: 'a' },
        tint: { type: 'color', default: '#38bdf8' },
        on: { type: 'boolean', default: true },
        fancy: helperFromElsewhere({ x: 1 }),
        plain: 5,
      };
    }
    globalThis.__pwned = true;
  `;
  const schema = extractScriptPropsSchema(code);
  assert.equal(schema.found, true);
  assert.equal(schema.partial, true, 'a helper call cannot be read statically');
  assert.equal(globalThis.__pwned, undefined);
  assert.deepEqual(schema.props.map((p) => p.name), ['size', 'mode', 'tint', 'on', 'fancy', 'plain']);
  assert.equal(schema.props.find((p) => p.name === 'fancy').type, 'unknown');

  assert.deepEqual(validateEntityProps(schema, { size: 50, mode: 'b', tint: '#fff', on: false, fancy: 'anything', plain: 7 }), []);
  const errors = validateEntityProps(schema, { size: 500, mode: 'z', tint: 3, on: 'yes', nope: 1, plain: 'x' });
  assert.equal(errors.length, 6, errors.join('\n'));
  assert.ok(errors.some((e) => /Unknown prop "nope"/.test(e)));

  // a script with no props declaration cannot be checked, so nothing is reported
  assert.deepEqual(validateEntityProps(extractScriptPropsSchema('export default function X() {}'), { anything: 1 }), []);
});

test('loadScriptSchema returns null for a missing script', async () => {
  const dir = await project();
  try {
    assert.equal(await loadScriptSchema(dir, 'Ghost'), null);
    await createScript({ dir, name: 'Real' });
    assert.equal((await loadScriptSchema(dir, 'Real')).props.length, 3);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});


test('extractScriptPropsSchema statically extracts common prop helper calls', () => {
  const code = `
    export default class HelperScript extends CanvasComponent {
      static props = {
        speed: num(2.5, { min: 0, max: 10, step: 0.1, label: 'Playback Speed' }),
        active: bool(true),
        tint: color('#ff4444'),
        headline: text('Welcome'),
        layout: select('center', ['left', 'center', 'right']),
        fontFamily: font('Roboto'),
        bgVideo: asset('video'),
        clipTarget: entity(),
        trigger: button('doAction'),
      };
    }
  `;
  const schema = extractScriptPropsSchema(code);
  assert.equal(schema.found, true);
  assert.equal(schema.partial, false, 'built-in prop helpers are statically resolved');

  const speed = schema.props.find((p) => p.name === 'speed');
  assert.equal(speed.type, 'number');
  assert.equal(speed.default, 2.5);
  assert.equal(speed.min, 0);
  assert.equal(speed.max, 10);
  assert.equal(speed.step, 0.1);
  assert.equal(speed.label, 'Playback Speed');

  assert.equal(schema.props.find((p) => p.name === 'active').type, 'boolean');
  assert.equal(schema.props.find((p) => p.name === 'active').default, true);

  assert.equal(schema.props.find((p) => p.name === 'tint').type, 'color');
  assert.equal(schema.props.find((p) => p.name === 'tint').default, '#ff4444');

  assert.equal(schema.props.find((p) => p.name === 'headline').type, 'string');
  assert.equal(schema.props.find((p) => p.name === 'headline').default, 'Welcome');

  const layout = schema.props.find((p) => p.name === 'layout');
  assert.equal(layout.type, 'select');
  assert.equal(layout.default, 'center');
  assert.deepEqual(layout.options, ['left', 'center', 'right']);

  assert.equal(schema.props.find((p) => p.name === 'fontFamily').type, 'font');
  assert.equal(schema.props.find((p) => p.name === 'fontFamily').default, 'Roboto');

  const bgVideo = schema.props.find((p) => p.name === 'bgVideo');
  assert.equal(bgVideo.type, 'asset');
  assert.equal(bgVideo.assetType, 'video');

  assert.equal(schema.props.find((p) => p.name === 'clipTarget').type, 'entity');
  assert.equal(schema.props.find((p) => p.name === 'trigger').type, 'button');
});
