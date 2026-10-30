import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile, assertAllowedPath, isInside, resolveProjectDir } from './fsutil.js';
import {
  UNSUPPORTED,
  findMatchingBracket,
  parseLiteral,
  positionOf,
  scanBrackets,
} from './jsscan.js';

export const MAX_SCRIPT_BYTES = 512 * 1024;
const SCRIPT_EXTENSIONS = ['.jsx', '.js', '.tsx', '.ts'];
const SCRIPT_FILE_RE = /\.(jsx?|tsx?)$/;

export const SCRIPT_TEMPLATES = {
  canvas: (name) => `import { CanvasComponent } from '@blahblah/sdk';

export default class ${name} extends CanvasComponent {
  static props = {
    title: { type: 'string', default: 'Hello BlahBlah' },
    color: { type: 'color', default: '#38bdf8' },
    size: { type: 'number', default: 40, min: 10, max: 200 },
  };

  onUpdate({ time, props }) {
    const { ctx, canvasWidth, canvasHeight } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Center origin (0, 0 is center of screen)
    this.centerOrigin();

    ctx.fillStyle = props.color;
    ctx.font = \`bold \${props.size}px sans-serif\`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(props.title, 0, Math.sin(time * 3) * 20);

    this.restoreOrigin();
  }
}
`,

  motion: (name) => `import { MotionScript } from '@blahblah/sdk';

export default class ${name} extends MotionScript {
  static props = {
    speed: { type: 'number', default: 1, min: 0.1, max: 10 },
    amplitude: { type: 'number', default: 50, min: 0, max: 500 },
  };

  onMount({ container, props }) {
    // Setup initial DOM or state
  }

  onUpdate({ time, props }) {
    // Update logic for every animation tick
  }

  onUnmount({ container }) {
    // Cleanup
  }
}
`,

  react: (name) => `import React from 'react';

export default function ${name}({ time = 0, title = 'Overlay Title', color = '#ffffff' }) {
  const opacity = Math.min(1, time * 2);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        color,
        fontSize: '48px',
        fontWeight: 'bold',
        opacity,
        textShadow: '0 4px 12px rgba(0,0,0,0.5)',
      }}
    >
      {title}
    </div>
  );
}
`,

  codesnippet: (name) => `import { CanvasComponent } from '@blahblah/sdk';

export default class ${name} extends CanvasComponent {
  static props = {
    code: { type: 'string', default: 'const x = 42;\\nconst y = x * 2;\\nconsole.log(y);' },
    language: { type: 'string', default: 'javascript' },
    fontSize: { type: 'number', default: 22, min: 10, max: 72 },
    bgColor: { type: 'color', default: '#1e1e2e' },
    textColor: { type: 'color', default: '#cdd6f4' },
    accentColor: { type: 'color', default: '#89b4fa' },
    typewriterSpeed: { type: 'number', default: 30, min: 0, max: 200 },
    padding: { type: 'number', default: 40, min: 0, max: 200 },
    lineHeight: { type: 'number', default: 1.6, min: 1.0, max: 3.0 },
  };

  onUpdate({ time, props }) {
    const { ctx, canvasWidth, canvasHeight } = this;
    if (!ctx) return;

    const {
      code = '',
      fontSize = 22,
      bgColor = '#1e1e2e',
      textColor = '#cdd6f4',
      accentColor = '#89b4fa',
      typewriterSpeed = 30,
      padding = 40,
      lineHeight = 1.6,
    } = props;

    // Clear & background
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Top accent bar
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, 0, canvasWidth, 4);

    // Typewriter effect: calculate visible characters
    const fullCode = String(code);
    const visibleCount = typewriterSpeed > 0
      ? Math.min(Math.floor(time * typewriterSpeed), fullCode.length)
      : fullCode.length;
    const visibleCode = fullCode.slice(0, visibleCount);

    // Draw lines
    ctx.fillStyle = textColor;
    ctx.font = \`\${fontSize}px monospace\`;
    ctx.textBaseline = 'top';

    const lines = visibleCode.split('\\n');
    const lineH = fontSize * lineHeight;

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], padding, padding + 4 + i * lineH);
    }

    // Blinking cursor at end of last visible character
    if (visibleCount < fullCode.length) {
      const lastLine = lines[lines.length - 1] || '';
      const lineIndex = lines.length - 1;
      const textW = ctx.measureText(lastLine).width;
      const cursorX = padding + textW + 2;
      const cursorY = padding + 4 + lineIndex * lineH;
      const showCursor = Math.floor(time * 2) % 2 === 0;
      if (showCursor) {
        ctx.fillStyle = accentColor;
        ctx.fillRect(cursorX, cursorY, 3, fontSize + 4);
      }
    }
  }
}
`,
};


export class ScriptValidationError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = 'ScriptValidationError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Turns a user-supplied name ("Lower Third", "Foo.jsx") into a safe script
 * identifier. Throws when nothing usable is left.
 */
export function sanitizeScriptName(name) {
  const base = String(name ?? '').trim().replace(/\.(jsx?|tsx?)$/i, '');
  const safe = base.replace(/[^a-zA-Z0-9_]/g, '');
  if (!safe) {
    throw new Error(`"${name}" is not a usable script name. Use letters, digits and underscores.`);
  }
  if (!/^[A-Za-z_]/.test(safe)) {
    throw new Error(`Script name "${safe}" must start with a letter or underscore (it becomes a class name).`);
  }
  return safe;
}

function scriptsDirOf(dir) {
  return path.join(resolveProjectDir(dir), 'scripts');
}

export async function createScript({
  dir = process.cwd(),
  name = 'CustomOverlay',
  type = 'canvas',
  overwrite = false,
} = {}) {
  const scriptsDir = scriptsDirOf(dir);
  await fs.mkdir(scriptsDir, { recursive: true });

  const safeName = sanitizeScriptName(name);
  const fileName = `${safeName}.jsx`;
  const filePath = path.join(scriptsDir, fileName);

  if (!Object.prototype.hasOwnProperty.call(SCRIPT_TEMPLATES, type)) {
    throw new Error(
      `Unknown script type "${type}". Use one of: ${Object.keys(SCRIPT_TEMPLATES).join(', ')}.`
    );
  }
  const content = SCRIPT_TEMPLATES[type](safeName);

  if (overwrite) {
    await atomicWriteFile(filePath, content, { backup: true });
  } else {
    try {
      // 'wx' fails if the file exists, so a user's script is never replaced silently.
      await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      if (err.code === 'EEXIST') {
        throw new Error(`Script "${fileName}" already exists. Choose another name or pass overwrite: true.`);
      }
      throw err;
    }
  }

  return {
    name: safeName,
    fileName,
    filePath,
    type,
    code: content,
  };
}

/**
 * Finds scripts/<name>.(jsx|js|tsx|ts) and returns its path, or null.
 */
export async function findScriptFile(dir, name) {
  const scriptsDir = scriptsDirOf(dir);
  const safeName = sanitizeScriptName(name);
  for (const ext of SCRIPT_EXTENSIONS) {
    const filePath = path.join(scriptsDir, `${safeName}${ext}`);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // try next extension
    }
  }
  return null;
}

function detectKind(content) {
  if (/\bCanvasComponent\b/.test(content)) return 'canvas';
  if (/\bMotionScript\b/.test(content)) return 'motion';
  return 'react';
}

export async function listScripts(dir = process.cwd()) {
  const scriptsDir = scriptsDirOf(dir);
  try {
    const entries = await fs.readdir(scriptsDir);
    const scriptFiles = entries.filter((f) => SCRIPT_FILE_RE.test(f)).sort();
    const results = [];

    for (const file of scriptFiles) {
      const fullPath = path.join(scriptsDir, file);
      const content = await fs.readFile(fullPath, 'utf8');
      const schema = extractScriptPropsSchema(content);
      results.push({
        name: file.replace(SCRIPT_FILE_RE, ''),
        fileName: file,
        filePath: fullPath,
        kind: detectKind(content),
        props: schema.props.map((p) => p.name),
      });
    }

    return results;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Reads a script's source and its declared props.
 */
export async function readScript(dir, name) {
  const filePath = await findScriptFile(dir, name);
  if (!filePath) throw new Error(`Script "${name}" not found in scripts/.`);
  const code = await fs.readFile(filePath, 'utf8');
  const schema = extractScriptPropsSchema(code);
  return {
    name: path.basename(filePath).replace(SCRIPT_FILE_RE, ''),
    fileName: path.basename(filePath),
    filePath,
    kind: detectKind(code),
    code,
    props: schema.props,
    propsPartial: schema.partial,
  };
}

/**
 * Props schema for a script on disk, or null when the script does not exist.
 * Used to check prop names/types before they are stored in project.json.
 */
export async function loadScriptSchema(dir, name) {
  const filePath = await findScriptFile(dir, name);
  if (!filePath) return null;
  const code = await fs.readFile(filePath, 'utf8');
  return { filePath, ...extractScriptPropsSchema(code) };
}

/**
 * Reads `static props = { ... }` as DATA (the script is never executed).
 * Entries the reader cannot understand statically (helper calls, spreads)
 * come back with type "unknown" and `partial: true`.
 */
export function extractScriptPropsSchema(code) {
  const empty = { found: false, partial: false, props: [] };
  if (typeof code !== 'string') return empty;

  const match = /static\s+props\s*=\s*\{/.exec(code);
  if (!match) return empty;

  const open = match.index + match[0].length - 1;
  const close = findMatchingBracket(code, open);
  if (close === -1) return { ...empty, found: true, partial: true };

  const { value, partial } = parseLiteral(code.slice(open, close + 1));
  if (!value || typeof value !== 'object' || value === UNSUPPORTED) {
    return { ...empty, found: true, partial: true };
  }

  const props = Object.entries(value).map(([name, def]) => {
    if (def === UNSUPPORTED) return { name, type: 'unknown' };
    if (Array.isArray(def)) {
      return { name, type: `${typeof def[0] === 'number' ? 'number' : 'string'}[]`, default: def };
    }
    if (def && typeof def === 'object') {
      const entry = {
        name,
        type:
          typeof def.type === 'string'
            ? def.type
            : def.type === UNSUPPORTED
              ? 'unknown'
              : typeof def.default === 'number'
                ? 'number'
                : typeof def.default === 'boolean'
                  ? 'boolean'
                  : 'string',
      };
      if (def.default !== undefined && def.default !== UNSUPPORTED) entry.default = def.default;
      for (const key of ['min', 'max', 'step']) {
        if (typeof def[key] === 'number') entry[key] = def[key];
      }
      if (Array.isArray(def.options)) entry.options = def.options.filter((o) => o !== UNSUPPORTED);
      if (typeof def.label === 'string') entry.label = def.label;
      if (typeof def.assetType === 'string') entry.assetType = def.assetType;
      return entry;
    }
    const valueType = typeof def === 'number' ? 'number' : typeof def === 'boolean' ? 'boolean' : 'string';
    return {
      name,
      type: valueType === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(def) ? 'color' : valueType,
      default: def,
    };
  });

  return { found: true, partial, props };
}

// ─── Validation ──────────────────────────────────────────────────────────────

let esbuildPromise = null;

/**
 * Loads esbuild (native) or esbuild-wasm when either is installed next to the
 * project. Returns null when neither can be loaded; validation then falls back
 * to the built-in bracket scanner.
 */
async function getEsbuild() {
  if (!esbuildPromise) {
    esbuildPromise = (async () => {
      for (const pkg of ['esbuild', 'esbuild-wasm']) {
        try {
          const mod = await import(pkg);
          const api = mod.transform ? mod : mod.default;
          if (!api || typeof api.transform !== 'function') continue;
          if (pkg === 'esbuild-wasm' && typeof api.initialize === 'function') {
            try {
              await api.initialize({});
            } catch (err) {
              if (!/more than once/i.test(String(err && err.message))) throw err;
            }
          }
          return api;
        } catch {
          // try the next package
        }
      }
      return null;
    })();
  }
  return esbuildPromise;
}

function loaderFor(fileName) {
  if (/\.tsx$/i.test(fileName)) return 'tsx';
  if (/\.ts$/i.test(fileName)) return 'ts';
  return 'jsx';
}

function propsWarnings(schema) {
  const warnings = [];
  for (const p of schema.props) {
    if (typeof p.min === 'number' && typeof p.max === 'number' && p.min > p.max) {
      warnings.push(`"${p.name}": min (${p.min}) is greater than max (${p.max}).`);
    }
    if (p.type === 'number' && typeof p.default === 'number') {
      if (typeof p.min === 'number' && p.default < p.min) {
        warnings.push(`"${p.name}": default (${p.default}) is below min (${p.min}).`);
      }
      if (typeof p.max === 'number' && p.default > p.max) {
        warnings.push(`"${p.name}": default (${p.default}) is above max (${p.max}).`);
      }
    }
    if (p.type === 'select' && (!Array.isArray(p.options) || p.options.length === 0)) {
      warnings.push(`"${p.name}": select has no options.`);
    }
  }
  return warnings;
}

function formatDiagnostic(d) {
  return `Line ${d.line}:${d.column}: ${d.message}`;
}

/**
 * Validates script source. With esbuild available this is a real parse, so
 * syntax errors come back with line and column; otherwise a string/comment
 * aware bracket scan is used (`engine: 'basic'`).
 *
 * `codeOrFilePath` is either source text or a path to a .js/.jsx/.ts/.tsx file.
 * Paths must be inside `<baseDir>/scripts` (or, without baseDir, inside some
 * folder named "scripts") unless `unrestricted` is set, so a tool client cannot
 * use this to read arbitrary files.
 */
export async function validateScript(codeOrFilePath, { baseDir, unrestricted = false } = {}) {
  let code = codeOrFilePath;
  let filePath = null;
  let fileName = 'script.jsx';

  const looksLikePath =
    typeof codeOrFilePath === 'string' &&
    !codeOrFilePath.includes('\n') &&
    SCRIPT_FILE_RE.test(codeOrFilePath);

  if (looksLikePath) {
    const resolved = path.resolve(baseDir ? resolveProjectDir(baseDir) : '.', codeOrFilePath);
    if (!unrestricted) {
      assertAllowedPath(resolved);
      const insideScripts = baseDir
        ? isInside(path.join(resolveProjectDir(baseDir), 'scripts'), resolved)
        : path.basename(path.dirname(resolved)) === 'scripts';
      if (!insideScripts) {
        throw new Error('Script files must be inside the project "scripts" folder.');
      }
    }
    try {
      code = await fs.readFile(resolved, 'utf8');
      filePath = resolved;
      fileName = path.basename(resolved);
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error(`Script file not found: ${resolved}`);
      throw err;
    }
  }

  if (typeof code !== 'string') {
    throw new Error('validateScript needs script source text or a script file path.');
  }

  const diagnostics = [];
  let engine = 'basic';
  let hasDefaultExport = /(^|[\n;}])\s*export\s+default\s+/.test(code);

  const esbuild = await getEsbuild();
  if (esbuild) {
    engine = 'esbuild';
    try {
      const out = await esbuild.transform(code, {
        loader: loaderFor(fileName),
        format: 'esm',
        sourcefile: fileName,
        logLevel: 'silent',
      });
      // esbuild strips comments, so this cannot match "export default" in a comment.
      hasDefaultExport =
        /^\s*export\s+default\b/m.test(out.code) || /export\s*\{[^}]*\bas\s+default\b/.test(out.code);
      for (const w of out.warnings || []) {
        diagnostics.push({
          severity: 'warning',
          line: w.location?.line ?? 1,
          column: (w.location?.column ?? 0) + 1,
          message: w.text,
        });
      }
    } catch (err) {
      const list = Array.isArray(err.errors) && err.errors.length > 0 ? err.errors : null;
      if (!list) throw err;
      for (const e of list) {
        diagnostics.push({
          severity: 'error',
          line: e.location?.line ?? 1,
          column: (e.location?.column ?? 0) + 1,
          message: e.text,
        });
      }
    }
  } else {
    diagnostics.push(...scanBrackets(code));
  }

  const hasSyntaxErrors = diagnostics.some((d) => d.severity === 'error');
  if (!hasSyntaxErrors && !hasDefaultExport) {
    diagnostics.push({
      severity: 'error',
      line: 1,
      column: 1,
      message: 'Missing "export default": every script must export a default class or function.',
    });
  }

  const schema = extractScriptPropsSchema(code);
  const extraWarnings = propsWarnings(schema);
  for (const cls of ['CanvasComponent', 'MotionScript']) {
    if (
      new RegExp(`extends\\s+${cls}\\b`).test(code) &&
      !new RegExp(`import[^;]*\\b${cls}\\b`).test(code)
    ) {
      extraWarnings.push(`Class extends ${cls} but it is not imported (use: import { ${cls} } from '@blahblah/sdk').`);
    }
  }
  if (engine === 'basic') {
    extraWarnings.push(
      'esbuild is not installed, so only bracket balance was checked. Install esbuild or esbuild-wasm for full syntax checking.'
    );
  }

  const errors = diagnostics.filter((d) => d.severity === 'error').map(formatDiagnostic);
  const warnings = [
    ...diagnostics.filter((d) => d.severity === 'warning').map(formatDiagnostic),
    ...extraWarnings,
  ];

  return {
    valid: errors.length === 0,
    engine,
    filePath,
    errors,
    warnings,
    diagnostics,
    detectedProps: schema.props.map((p) => p.name),
    props: schema.props,
    propsPartial: schema.partial,
    hasDefaultExport,
  };
}

/**
 * Writes a script into scripts/ after validating it. Nothing is written when
 * the code has syntax errors (unless `allowInvalid`), and an existing script is
 * only replaced when `overwrite` is true (the old file is kept as .bak).
 */
export async function writeScript({
  dir = process.cwd(),
  name,
  code,
  overwrite = false,
  allowInvalid = false,
} = {}) {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new Error('Script code is required.');
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_SCRIPT_BYTES) {
    throw new Error(`Script is larger than ${MAX_SCRIPT_BYTES / 1024} KB.`);
  }

  const scriptsDir = scriptsDirOf(dir);
  const safeName = sanitizeScriptName(name);
  const fileName = `${safeName}.jsx`;
  const filePath = path.join(scriptsDir, fileName);

  const validation = await validateScript(code);
  if (!validation.valid && !allowInvalid) {
    throw new ScriptValidationError(
      `Script was NOT written: ${validation.errors.length} error(s).\n${validation.errors.join('\n')}`,
      validation.diagnostics
    );
  }

  const existing = await findScriptFile(dir, safeName);
  if (existing && !overwrite) {
    throw new Error(
      `Script "${path.basename(existing)}" already exists. Pass overwrite: true to replace it (a .bak copy is kept).`
    );
  }
  if (existing && existing !== filePath) {
    throw new Error(
      `A script named "${path.basename(existing)}" already exists with a different extension; refusing to create "${fileName}" next to it.`
    );
  }

  await fs.mkdir(scriptsDir, { recursive: true });
  await atomicWriteFile(filePath, code, { backup: Boolean(existing) });

  return {
    name: safeName,
    fileName,
    filePath,
    replaced: Boolean(existing),
    validation,
  };
}