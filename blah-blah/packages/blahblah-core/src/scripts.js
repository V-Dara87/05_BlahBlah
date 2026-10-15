import fs from 'node:fs/promises';
import path from 'node:path';

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
    ctx.font = \\\`\\\${fontSize}px monospace\\\`;
    ctx.textBaseline = 'top';

    const lines = visibleCode.split('\\\\n');
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

export async function createScript({
  dir = process.cwd(),
  name = 'CustomOverlay',
  type = 'canvas',
} = {}) {
  const scriptsDir = path.resolve(dir, 'scripts');
  await fs.mkdir(scriptsDir, { recursive: true });

  const safeName = name.replace(/[^a-zA-Z0-9_]/g, '');
  const fileName = `${safeName}.jsx`;
  const filePath = path.join(scriptsDir, fileName);

  const templateFn = SCRIPT_TEMPLATES[type] || SCRIPT_TEMPLATES.canvas;
  const content = templateFn(safeName);

  await fs.writeFile(filePath, content, 'utf8');

  return {
    name: safeName,
    fileName,
    filePath,
    type,
    code: content,
  };
}

export async function listScripts(dir = process.cwd()) {
  const scriptsDir = path.resolve(dir, 'scripts');
  try {
    const entries = await fs.readdir(scriptsDir);
    const scriptFiles = entries.filter((f) => /\.(jsx?|tsx?)$/.test(f));
    const results = [];

    for (const file of scriptFiles) {
      const fullPath = path.join(scriptsDir, file);
      const content = await fs.readFile(fullPath, 'utf8');
      const isCanvas = content.includes('CanvasComponent');
      const isMotion = content.includes('MotionScript');
      const isReact = !isCanvas && !isMotion;

      results.push({
        fileName: file,
        filePath: fullPath,
        kind: isCanvas ? 'canvas' : isMotion ? 'motion' : 'react',
      });
    }

    return results;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Validates a script's content.
 */
export async function validateScript(codeOrFilePath) {
  let code = codeOrFilePath;
  let filePath = null;

  if (typeof codeOrFilePath === 'string' && (codeOrFilePath.endsWith('.js') || codeOrFilePath.endsWith('.jsx') || codeOrFilePath.endsWith('.tsx'))) {
    try {
      filePath = path.resolve(codeOrFilePath);
      code = await fs.readFile(filePath, 'utf8');
    } catch (e) {
      // not a file path or file unreadable, treat as raw code
    }
  }

  const errors = [];
  const warnings = [];

  // Check 1: Default export
  const hasDefaultExport = /export\s+default\s+/.test(code);
  if (!hasDefaultExport) {
    errors.push('Missing "export default": Every script must export a default class or function.');
  }

  // Check 2: Basic balanced brackets/braces syntax sanity
  let braceCount = 0;
  let parenCount = 0;
  for (const ch of code) {
    if (ch === '{') braceCount++;
    else if (ch === '}') braceCount--;
    else if (ch === '(') parenCount++;
    else if (ch === ')') parenCount--;
  }

  if (braceCount !== 0) {
    errors.push(`Unmatched curly braces: count difference is ${braceCount}.`);
  }
  if (parenCount !== 0) {
    errors.push(`Unmatched parentheses: count difference is ${parenCount}.`);
  }

  // Check 3: Extract static props declaration if any
  const propsMatch = code.match(/static\s+props\s*=\s*(\{[\s\S]*?\n\s*\};)/);
  const detectedProps = [];
  if (propsMatch) {
    const rawProps = propsMatch[1];
    const propNames = rawProps.matchAll(/([a-zA-Z0-9_]+)\s*:\s*\{/g);
    for (const match of propNames) {
      detectedProps.push(match[1]);
    }
  }

  return {
    valid: errors.length === 0,
    filePath,
    errors,
    warnings,
    detectedProps,
    hasDefaultExport,
  };
}
