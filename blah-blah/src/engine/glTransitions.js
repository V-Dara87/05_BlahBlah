/**
 * WebGL-based GL Transitions Engine for BlahBlah
 * 
 * Provides hardware-accelerated GLSL shader transitions (gl-transitions compatible)
 * with deterministic evaluation for both real-time timeline preview and offline MP4 export.
 */

import rawTransitions from 'gl-transitions';

// ─── Curated Featured Presets ───────────────────────────────────────────────

export const FEATURED_TRANSITIONS = [
  {
    id: 'glitchMemories',
    name: 'Glitch Memories',
    category: 'Glitch & Sci-Fi',
    description: 'Cyberpunk chromatic aberration and digital scanline tear',
    glsl: `
vec4 transition(vec2 uv) {
  vec2 p = uv;
  vec2 block = floor(p * vec2(16.0, 16.0));
  vec2 uv_noise = block / vec2(16.0, 16.0);
  float d = sin(progress * 3.14159265);
  float shift = (sin(uv_noise.y * 100.0 + progress * 20.0) * 0.05) * d;
  vec4 fromColor = vec4(
    getFromColor(p + vec2(shift, 0.0)).r,
    getFromColor(p).g,
    getFromColor(p - vec2(shift, 0.0)).b,
    getFromColor(p).a
  );
  vec4 toColor = vec4(
    getToColor(p + vec2(shift * 0.5, 0.0)).r,
    getToColor(p).g,
    getToColor(p - vec2(shift * 0.5, 0.0)).b,
    getToColor(p).a
  );
  return mix(fromColor, toColor, progress);
}
`,
  },
  {
    id: 'crossZoom',
    name: 'Cross Zoom',
    category: 'Warp & Zoom',
    description: 'Dynamic high-speed whip zoom-through',
    glsl: `
vec4 transition(vec2 uv) {
  vec2 center = vec2(0.5, 0.5);
  float strength = 0.4;
  vec2 toCenter = center - uv;
  vec2 offset = toCenter * (progress * (1.0 - progress) * strength);
  vec4 c1 = getFromColor(uv + offset * (1.0 - progress));
  vec4 c2 = getToColor(uv - offset * progress);
  return mix(c1, c2, progress);
}
`,
  },
  {
    id: 'dreamy',
    name: 'Dreamy',
    category: 'Distortion & Fluid',
    description: 'Dreamy optical chromatic wave distortion',
    glsl: `
vec4 transition(vec2 uv) {
  float wave = sin(uv.y * 20.0 + progress * 6.28318) * 0.03 * sin(progress * 3.14159265);
  vec2 p = uv + vec2(wave, 0.0);
  return mix(getFromColor(p), getToColor(p), progress);
}
`,
  },
  {
    id: 'ripple',
    name: 'Water Ripple',
    category: 'Distortion & Fluid',
    description: 'Liquid concentric ripple shockwave',
    glsl: `
vec4 transition(vec2 uv) {
  vec2 p = uv - vec2(0.5);
  float dist = length(p);
  float wave = sin(dist * 30.0 - progress * 15.0) * 0.03 * (1.0 - progress);
  vec2 offset = p * wave;
  return mix(getFromColor(uv + offset), getToColor(uv - offset), progress);
}
`,
  },
  {
    id: 'directionalWipe',
    name: 'Directional Wipe',
    category: 'Wipes',
    description: 'Linear angled wipe with soft feathered edge',
    glsl: `
vec4 transition(vec2 uv) {
  vec2 direction = vec2(1.0, 0.0);
  float smoothness = 0.15;
  float p = progress * (1.0 + smoothness);
  float edge = dot(uv, direction);
  float m = smoothstep(p - smoothness, p, edge);
  return mix(getToColor(uv), getFromColor(uv), m);
}
`,
  },
  {
    id: 'circleCrop',
    name: 'Circle Iris',
    category: 'Wipes',
    description: 'Cinematic circular iris expansion',
    glsl: `
vec4 transition(vec2 uv) {
  float dist = distance(uv, vec2(0.5, 0.5));
  float radius = 0.7071 * progress;
  float edge = smoothstep(radius - 0.02, radius, dist);
  return mix(getToColor(uv), getFromColor(uv), edge);
}
`,
  },
  {
    id: 'doomScreen',
    name: 'Doom Melt',
    category: 'Retro & Stylized',
    description: 'Classic 90s DOOM vertical melting screen dissolve',
    glsl: `
float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}
vec4 transition(vec2 uv) {
  float barCount = 32.0;
  float barIndex = floor(uv.x * barCount);
  float drip = rand(vec2(barIndex, 0.0)) * 0.45;
  float drop = max(0.0, (progress * 1.5 - drip));
  vec2 p = uv + vec2(0.0, drop * drop * 1.6);
  if (p.y > 1.0) {
    return getToColor(uv);
  }
  return mix(getFromColor(p), getToColor(uv), smoothstep(0.75, 1.0, progress));
}
`,
  },
  {
    id: 'pixelize',
    name: 'Pixelize',
    category: 'Retro & Stylized',
    description: 'Retro 8-bit mosaic pixelation dissolve',
    glsl: `
vec4 transition(vec2 uv) {
  float d = min(progress, 1.0 - progress);
  float factor = max(1.0, floor((1.0 - d) * 35.0));
  vec2 p = floor(uv * factor) / factor;
  return mix(getFromColor(p), getToColor(p), progress);
}
`,
  },
  {
    id: 'swirl',
    name: 'Swirl Vortex',
    category: 'Distortion & Fluid',
    description: 'Rotating vortex distortion wave',
    glsl: `
vec4 transition(vec2 uv) {
  float Radius = 0.8;
  float Angle = 3.14159265 * 2.0;
  vec2 p = uv - vec2(0.5);
  float dist = length(p);
  if (dist < Radius) {
    float percent = (Radius - dist) / Radius;
    float theta = percent * percent * Angle * (1.0 - progress) * progress * 3.5;
    float s = sin(theta);
    float c = cos(theta);
    p = vec2(dot(p, vec2(c, -s)), dot(p, vec2(s, c)));
  }
  p += vec2(0.5);
  return mix(getFromColor(p), getToColor(p), progress);
}
`,
  },
  {
    id: 'filmBurn',
    name: 'Film Burn',
    category: 'Retro & Stylized',
    description: 'Warm vintage light leak flare dissolve',
    glsl: `
vec4 transition(vec2 uv) {
  vec4 a = getFromColor(uv);
  vec4 b = getToColor(uv);
  float t = sin(progress * 3.14159265);
  vec3 burnColor = vec3(1.0, 0.55, 0.15) * (t * 2.2);
  vec3 res = mix(a.rgb, b.rgb, progress) + burnColor * (1.0 - distance(uv, vec2(0.5)));
  return vec4(res, mix(a.a, b.a, progress));
}
`,
  },
  {
    id: 'wind',
    name: 'Wind Streak',
    category: 'Wipes',
    description: 'Horizontal wind particle streak wipe',
    glsl: `
float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}
vec4 transition(vec2 uv) {
  float r = rand(vec2(0.0, uv.y));
  float m = smoothstep(0.0, -0.4, uv.x * 0.6 + 0.4 * r - (progress * 1.4));
  return mix(getFromColor(uv), getToColor(uv), m);
}
`,
  },
  {
    id: 'crossfade',
    name: 'Crossfade',
    category: 'Basic',
    description: 'Clean dissolve blend between visuals',
    glsl: `
vec4 transition(vec2 uv) {
  return mix(getFromColor(uv), getToColor(uv), progress);
}
`,
  }
];

// Map all 125 gl-transitions package entries into available transitions
export const ALL_GL_TRANSITIONS = (() => {
  const featuredIds = new Set(FEATURED_TRANSITIONS.map(p => p.id.toLowerCase()));
  const fullList = [...FEATURED_TRANSITIONS];

  if (Array.isArray(rawTransitions)) {
    rawTransitions.forEach((t) => {
      const id = t.name.charAt(0).toLowerCase() + t.name.slice(1);
      if (!featuredIds.has(id.toLowerCase())) {
        fullList.push({
          id,
          name: t.name.replace(/([A-Z])/g, ' $1').trim(),
          category: 'Library',
          description: `By ${t.author || 'gl-transitions'}`,
          glsl: t.glsl,
          defaultParams: t.defaultParams,
        });
      }
    });
  }

  return fullList;
})();

export const GL_CATEGORIES = [
  'All',
  'Glitch & Sci-Fi',
  'Warp & Zoom',
  'Distortion & Fluid',
  'Wipes',
  'Retro & Stylized',
  'Basic',
  'Library',
];

export function getTransitionPreset(id) {
  if (!id) return FEATURED_TRANSITIONS[0];
  const lower = id.toLowerCase();
  return (
    ALL_GL_TRANSITIONS.find((p) => p.id.toLowerCase() === lower || p.name.toLowerCase() === lower) ||
    FEATURED_TRANSITIONS[0]
  );
}

// ─── WebGL Transition Renderer ──────────────────────────────────────────────

const VERTEX_SHADER_SOURCE = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = (position + 1.0) * 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

function createFragmentShaderSource(transitionGlsl) {
  return `
precision highp float;
varying vec2 uv;
uniform sampler2D from;
uniform sampler2D to;
uniform float progress;
uniform float ratio;
uniform float _fromR;
uniform float _toR;

vec4 getFromColor(vec2 p) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) {
    return vec4(0.0);
  }
  return texture2D(from, p);
}

vec4 getToColor(vec2 p) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) {
    return vec4(0.0);
  }
  return texture2D(to, p);
}

${transitionGlsl}

void main() {
  gl_FragColor = transition(uv);
}
`;
}

export class GLTransitionRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 360;
    this.gl = this.canvas.getContext('webgl', { 
      alpha: true, 
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    });

    if (!this.gl) {
      console.warn('WebGL is not supported for GL Transitions.');
      return;
    }

    const gl = this.gl;
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1.0, -1.0,
         1.0, -1.0,
        -1.0,  1.0,
         1.0,  1.0,
      ]),
      gl.STATIC_DRAW
    );

    this.fromTexture = gl.createTexture();
    this.toTexture = gl.createTexture();
    [this.fromTexture, this.toTexture].forEach((tex) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    });

    this.emptyTextureSource = document.createElement('canvas');
    this.emptyTextureSource.width = 2;
    this.emptyTextureSource.height = 2;
    const ectx = this.emptyTextureSource.getContext('2d');
    ectx.clearRect(0, 0, 2, 2);

    this.programCache = new Map();
  }

  getProgram(glslCode) {
    if (this.programCache.has(glslCode)) {
      return this.programCache.get(glslCode);
    }

    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, VERTEX_SHADER_SOURCE);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error('Vertex shader compilation error:', gl.getShaderInfoLog(vs));
      return null;
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, createFragmentShaderSource(glslCode));
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error('Fragment shader compilation error:', gl.getShaderInfoLog(fs));
      return null;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Shader link error:', gl.getProgramInfoLog(program));
      return null;
    }

    const compiled = {
      program,
      positionAttr: gl.getAttribLocation(program, 'position'),
      fromUniform: gl.getUniformLocation(program, 'from'),
      toUniform: gl.getUniformLocation(program, 'to'),
      progressUniform: gl.getUniformLocation(program, 'progress'),
      ratioUniform: gl.getUniformLocation(program, 'ratio'),
      fromRUniform: gl.getUniformLocation(program, '_fromR'),
      toRUniform: gl.getUniformLocation(program, '_toR'),
    };

    this.programCache.set(glslCode, compiled);
    return compiled;
  }

  uploadTexture(glTexture, source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    const validSource = source || this.emptyTextureSource;
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, validSource);
    } catch {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.emptyTextureSource);
    }
  }

  render({ from, to, progress = 0, presetId = 'crossfade', customGlsl, width, height }) {
    if (!this.gl) return this.canvas;
    const gl = this.gl;

    const targetWidth = Math.max(1, Math.round(width || this.canvas.width));
    const targetHeight = Math.max(1, Math.round(height || this.canvas.height));

    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }

    gl.viewport(0, 0, targetWidth, targetHeight);

    const preset = getTransitionPreset(presetId);
    const glsl = customGlsl || preset.glsl;
    const compiled = this.getProgram(glsl);

    if (!compiled) return this.canvas;

    gl.useProgram(compiled.program);

    gl.activeTexture(gl.TEXTURE0);
    this.uploadTexture(this.fromTexture, from);
    gl.uniform1i(compiled.fromUniform, 0);

    gl.activeTexture(gl.TEXTURE1);
    this.uploadTexture(this.toTexture, to);
    gl.uniform1i(compiled.toUniform, 1);

    const ratio = targetWidth / targetHeight;
    gl.uniform1f(compiled.progressUniform, Math.max(0, Math.min(1, progress)));
    gl.uniform1f(compiled.ratioUniform, ratio);
    if (compiled.fromRUniform) gl.uniform1f(compiled.fromRUniform, ratio);
    if (compiled.toRUniform) gl.uniform1f(compiled.toRUniform, ratio);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.enableVertexAttribArray(compiled.positionAttr);
    gl.vertexAttribPointer(compiled.positionAttr, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    return this.canvas;
  }
}

let sharedRendererInstance = null;
export function getSharedGLTransitionRenderer() {
  if (!sharedRendererInstance && typeof window !== 'undefined') {
    sharedRendererInstance = new GLTransitionRenderer();
  }
  return sharedRendererInstance;
}

// ─── Mini Animated Preview Canvas Generator ─────────────────────────────────

function createPreviewTextures() {
  const fromCanvas = document.createElement('canvas');
  fromCanvas.width = 120;
  fromCanvas.height = 70;
  const ctxA = fromCanvas.getContext('2d');
  ctxA.fillStyle = '#0f172a';
  ctxA.fillRect(0, 0, 120, 70);
  ctxA.fillStyle = '#0284c7';
  ctxA.beginPath();
  ctxA.arc(60, 35, 24, 0, Math.PI * 2);
  ctxA.fill();
  ctxA.fillStyle = '#ffffff';
  ctxA.font = 'bold 11px sans-serif';
  ctxA.textAlign = 'center';
  ctxA.textBaseline = 'middle';
  ctxA.fillText('CLIP A', 60, 35);

  const toCanvas = document.createElement('canvas');
  toCanvas.width = 120;
  toCanvas.height = 70;
  const ctxB = toCanvas.getContext('2d');
  ctxB.fillStyle = '#4c0519';
  ctxB.fillRect(0, 0, 120, 70);
  ctxB.fillStyle = '#e11d48';
  ctxB.fillRect(25, 12, 70, 46);
  ctxB.fillStyle = '#ffffff';
  ctxB.font = 'bold 11px sans-serif';
  ctxB.textAlign = 'center';
  ctxB.textBaseline = 'middle';
  ctxB.fillText('CLIP B', 60, 35);

  return { fromCanvas, toCanvas };
}

let cachedPreviewTextures = null;

export function startTransitionPreviewLoop(targetCanvas, presetId) {
  if (!cachedPreviewTextures && typeof window !== 'undefined') {
    cachedPreviewTextures = createPreviewTextures();
  }
  if (!cachedPreviewTextures) return () => {};

  const { fromCanvas, toCanvas } = cachedPreviewTextures;
  const renderer = getSharedGLTransitionRenderer();
  if (!renderer) return () => {};

  const ctx = targetCanvas.getContext('2d');
  let animId = null;
  const cycleDuration = 2200;

  const tick = (time) => {
    const cycle = (time % cycleDuration) / cycleDuration;
    let progress = 0;
    if (cycle < 0.15) {
      progress = 0;
    } else if (cycle < 0.85) {
      progress = (cycle - 0.15) / 0.7;
    } else {
      progress = 1;
    }

    const rendered = renderer.render({
      from: fromCanvas,
      to: toCanvas,
      progress,
      presetId,
      width: targetCanvas.width,
      height: targetCanvas.height,
    });

    if (ctx && rendered) {
      ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      ctx.drawImage(rendered, 0, 0, targetCanvas.width, targetCanvas.height);
    }

    animId = requestAnimationFrame(tick);
  };

  animId = requestAnimationFrame(tick);
  return () => {
    if (animId) cancelAnimationFrame(animId);
  };
}