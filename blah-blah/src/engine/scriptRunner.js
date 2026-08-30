import React from 'react';
import { 
  MotionTweenContext, 
  Easing, 
  Ease, 
  LoopType, 
  MathUtils, 
  interpolate, 
  spring 
} from './motionTween.js';
 
/**
 * Cache for compiled JavaScript/JSX modules to ensure 60fps performance without recompiling.
 */
const compiledModuleCache = new Map();
const propsSchemaCache = new Map();
const lastErrorCache = new Map();
const scriptKindCache = new Map();
 
/**
 * Lightweight JSX & TypeScript to JavaScript Transpiler for in-browser live scripting.
 */
export function transpileJsxToJs(codeStr) {
  if (!codeStr) return '';
 
  let code = codeStr;
 
  // 1. Remove TS type imports / interface / type declarations
  code = code.replace(/import\s+type\s+[^;]+;/g, '');
  code = code.replace(/export\s+type\s+[^;]+;/g, '');
  code = code.replace(/export\s+interface\s+[\s\S]*?\n\}/g, '');
  code = code.replace(/interface\s+[\s\S]*?\n\}/g, '');
  code = code.replace(/type\s+[A-Za-z0-9_]+\s*=\s*[^;]+;/g, '');
 
  // 2. Remove TS variable / parameter type annotations (e.g., `: number`, `: string`, `: any`)
  code = code.replace(/:\s*(?:number|string|boolean|any|void|object|Function|React\.[A-Za-z0-9_]+)\b/g, '');
 
  // 3. Remove standard ES module import statements (since scope is injected)
  code = code.replace(/import\s+(?:\{[^}]*\}|\*\s+as\s+[A-Za-z0-9_]+|[A-Za-z0-9_]+)\s+from\s+['"][^'"]+['"];?/g, '');
 
  // 4. Handle export default and export declarations for function execution
  let defaultExportName = null;
 
  code = code.replace(/export\s+default\s+class\s+([A-Za-z0-9_]+)/g, (_, name) => {
    defaultExportName = name;
    return `class ${name}`;
  });
 
  code = code.replace(/export\s+default\s+function\s+([A-Za-z0-9_]+)/g, (_, name) => {
    defaultExportName = name;
    return `function ${name}`;
  });
 
  code = code.replace(/export\s+default\s+/g, 'module.exports.default = ');
 
  code = code.replace(/export\s+(const|let|var|function|class)\s+([A-Za-z0-9_]+)/g, (_, decl, name) => {
    return `${decl} ${name}`;
  });
 
  // 5. Transform standard JSX to React.createElement
  code = transformJsxElements(code);
 
  if (defaultExportName) {
    code += `\nif (typeof ${defaultExportName} !== 'undefined') { module.exports.default = ${defaultExportName}; }\n`;
  }
 
  return code;
}
 
/**
 * Transforms JSX syntax into React.createElement calls
 */
function transformJsxElements(code) {
  // Replace JSX fragments <> ... </>
  code = code.replace(/<>\s*([\s\S]*?)\s*<\/>/g, (_, children) => {
    return `React.createElement(React.Fragment, null, ${parseJsxChildren(children)})`;
  });
 
  // 1. Replace self-closing JSX tags: <Tag prop="val" />
  let prevCode = '';
  let iters = 0;
  while (prevCode !== code && iters < 20) {
    prevCode = code;
    iters++;
    code = code.replace(/<([A-Za-z0-9_$.]+)((?:\s+[^=>\s/]+(?:=(?:"[^"]*"|'[^']*'|\{[^{}]*\}))?)*)\s*\/>/g, 
      (_, tag, rawProps) => {
        const propsObj = parseJsxProps(rawProps);
        const tagExpr = /^[A-Z]/.test(tag) || tag.includes('.') ? tag : `"${tag}"`;
        return `React.createElement(${tagExpr}, ${propsObj})`;
      }
    );
  }
 
  // 2. Iteratively replace innermost paired tags (children contain no '<')
  prevCode = '';
  iters = 0;
  while (prevCode !== code && iters < 30) {
    prevCode = code;
    iters++;
    code = code.replace(/<([A-Za-z0-9_$.]+)((?:\s+[^=>\s]+(?:=(?:"[^"]*"|'[^']*'|\{[^{}]*\}))?)*)\s*>([^<]*)<\/\1>/g,
      (_, tag, rawProps, children) => {
        const propsObj = parseJsxProps(rawProps);
        const tagExpr = /^[A-Z]/.test(tag) || tag.includes('.') ? tag : `"${tag}"`;
        const parsedChildren = parseJsxChildren(children);
        return parsedChildren 
          ? `React.createElement(${tagExpr}, ${propsObj}, ${parsedChildren})`
          : `React.createElement(${tagExpr}, ${propsObj})`;
      }
    );
  }
 
  return code;
}
 
function parseJsxProps(rawProps) {
  if (!rawProps || !rawProps.trim()) return 'null';
  const propPairs = [];
  let pos = 0;
  const str = rawProps.trim();
 
  while (pos < str.length) {
    while (pos < str.length && /\s/.test(str[pos])) pos++;
    if (pos >= str.length) break;
 
    const nameMatch = str.slice(pos).match(/^([A-Za-z0-9_$-]+)/);
    if (!nameMatch) {
      pos++;
      continue;
    }
 
    const propName = nameMatch[1];
    const key = propName === 'class' ? 'className' : propName;
    pos += propName.length;
 
    while (pos < str.length && /\s/.test(str[pos])) pos++;
 
    if (pos < str.length && str[pos] === '=') {
      pos++;
      while (pos < str.length && /\s/.test(str[pos])) pos++;
 
      if (str[pos] === '"' || str[pos] === "'") {
        const q = str[pos];
        pos++;
        const start = pos;
        while (pos < str.length && str[pos] !== q) {
          if (str[pos] === '\\') pos++;
          pos++;
        }
        const val = str.slice(start, pos);
        pos++;
        propPairs.push(`"${key}": ${JSON.stringify(val)}`);
      } else if (str[pos] === '{') {
        let braceDepth = 1;
        pos++;
        const start = pos;
        while (pos < str.length && braceDepth > 0) {
          if (str[pos] === '{') braceDepth++;
          else if (str[pos] === '}') braceDepth--;
          pos++;
        }
        const valExpr = str.slice(start, pos - 1).trim();
        propPairs.push(`"${key}": ${valExpr}`);
      }
    } else {
      propPairs.push(`"${key}": true`);
    }
  }
 
  return propPairs.length > 0 ? `{ ${propPairs.join(', ')} }` : 'null';
}
 
function parseJsxChildren(children) {
  if (!children || !children.trim()) return '';
  const tokens = [];
  let pos = 0;
  const str = children.trim();
 
  while (pos < str.length) {
    while (pos < str.length && /\s/.test(str[pos])) pos++;
    if (pos >= str.length) break;
 
    if (str[pos] === '{') {
      let braceDepth = 1;
      pos++;
      const start = pos;
      while (pos < str.length && braceDepth > 0) {
        if (str[pos] === '{') braceDepth++;
        else if (str[pos] === '}') braceDepth--;
        pos++;
      }
      const expr = str.slice(start, pos - 1).trim();
      if (expr) tokens.push(expr);
    } else if (str.slice(pos).startsWith('React.createElement(')) {
      let parenDepth = 1;
      const start = pos;
      pos += 'React.createElement('.length;
      while (pos < str.length && parenDepth > 0) {
        if (str[pos] === '(') parenDepth++;
        else if (str[pos] === ')') parenDepth--;
        else if (str[pos] === '"' || str[pos] === "'") {
          const q = str[pos];
          pos++;
          while (pos < str.length && str[pos] !== q) {
            if (str[pos] === '\\') pos++;
            pos++;
          }
        }
        pos++;
      }
      tokens.push(str.slice(start, pos));
    } else {
      const start = pos;
      while (pos < str.length && str[pos] !== '{' && !str.slice(pos).startsWith('React.createElement(')) {
        pos++;
      }
      const text = str.slice(start, pos).trim();
      if (text) {
        tokens.push(JSON.stringify(text));
      }
    }
  }
 
  return tokens.join(', ');
}
 
/**
 * Extracts public props schema for the Unity-style Inspector
 */
export function extractScriptProps(code) {
  if (!code) return [];
  if (propsSchemaCache.has(code)) {
    return propsSchemaCache.get(code);
  }
 
  const fields = [];
 
  try {
    // 1. Check for `static props = { ... }` or `export const props = { ... }` or `Component.props = { ... }`
    const propsMatch = code.match(/(?:static\s+props|\bprops)\s*=\s*(\{[\s\S]*?\n\s*\};?)/);
    if (propsMatch) {
      try {
        const schemaFunc = new Function(`return (${propsMatch[1].replace(/;$/, '')});`);
        const schemaObj = schemaFunc();
        if (schemaObj && typeof schemaObj === 'object') {
          Object.entries(schemaObj).forEach(([name, def]) => {
            if (typeof def === 'object' && def !== null) {
              fields.push({
                name,
                type: def.type || (typeof def.default === 'number' ? 'number' : typeof def.default === 'boolean' ? 'boolean' : 'string'),
                defaultVal: def.default ?? (def.type === 'number' ? 0 : def.type === 'boolean' ? false : ''),
                min: def.min,
                max: def.max,
                step: def.step,
                options: def.options,
                label: def.label || name,
              });
            } else {
              // Direct value mapping: { speed: 2.5, color: '#ff0000' }
              const valType = typeof def === 'number' ? 'number' : typeof def === 'boolean' ? 'boolean' : 'string';
              fields.push({
                name,
                type: valType === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(def) ? 'color' : valType,
                defaultVal: def,
                label: name,
              });
            }
          });
        }
      } catch {
        // Fallback to regex parser below
      }
    }
 
    // 2. Regex fallback for inline public fields: `public float x = 10;` or `propName: { type: 'number', default: 10 }`
    if (fields.length === 0) {
      const fieldRegex = /(?:public\s+)?([A-Za-z0-9_]+)\s*:\s*\{\s*type:\s*['"]([A-Za-z0-9_]+)['"]\s*,\s*default:\s*([^,}]+)/g;
      let m;
      while ((m = fieldRegex.exec(code)) !== null) {
        const name = m[1];
        const type = m[2];
        let defaultVal = m[3].trim().replace(/^['"]|['"]$/g, '');
        if (type === 'number') defaultVal = parseFloat(defaultVal) || 0;
        if (type === 'boolean') defaultVal = defaultVal === 'true';
        fields.push({ name, type, defaultVal, label: name });
      }
    }
  } catch (err) {
    console.warn('Prop extraction warning:', err);
  }
 
  propsSchemaCache.set(code, fields);
  return fields;
}
 
/**
 * P1.5-adjacent fix — script "kind" auto-detection.
 *
 * Before this, the Inspector's "Add Component" popover dumped every saved
 * script into all three script-based sections (React Clips, Canvas
 * Components, Motion Scripts) unconditionally — `canvasScripts = scripts`
 * and the Motion Scripts list both used the full, unfiltered `scripts`
 * array, so a single file like `CustomClip.jsx` showed up in all three
 * lists regardless of which contract it actually implements. Picking the
 * "wrong" section for it produced a component that silently did nothing
 * (or errored) at render time, since the runtime contract it doesn't match
 * ignores the arguments it doesn't expect.
 *
 * This inspects the script body (not just the filename) and returns which
 * single contract it actually satisfies, so the Inspector can filter each
 * section down to scripts that will actually work there:
 *   - 'canvas' — has an onMount(...) method (the CanvasRenderer contract:
 *                onMount/onUpdate/onUnmount driven by { container, ... }).
 *   - 'motion' — has onStart/onUpdate written against a `transform` arg
 *                (the ScriptComponent contract) and no onMount.
 *   - 'react'  — returns JSX / React.createElement and isn't a class using
 *                the motion or canvas method names.
 *   - 'unknown' — code doesn't clearly match any contract yet (e.g. a
 *                 fresh empty script); shown everywhere so it isn't
 *                 hidden while being written.
 *
 * This is intentionally cheap regex sniffing (consistent with
 * extractScriptProps above), not a real parse — good enough to route the
 * "Add Component" UI, not a substitute for the runtime actually failing
 * clearly if a script is attached to the wrong component type.
 */
export function detectScriptKind(code) {
  if (!code || !code.trim()) return 'unknown';
  if (scriptKindCache.has(code)) {
    return scriptKindCache.get(code);
  }
 
  let kind = 'unknown';
 
  const hasOnMount = /\bonMount\s*\(/.test(code);
  const hasOnUnmount = /\bonUnmount\s*\(/.test(code);
  const hasContainerArg = /\{\s*[^}]*\bcontainer\b[^}]*\}\s*\)\s*\{/.test(code);
 
  const hasOnStartOrOnUpdate = /\bonStart\s*\(|\bonUpdate\s*\(/.test(code);
  const hasTransformArg = /\{\s*[^}]*\btransform\b[^}]*\}\s*\)\s*\{/.test(code);
 
  // JSX detection also covers the `h(tag, props, children)` helper form
  // used by a couple of the built-in DEFAULT_SCRIPTS samples (shorthand for
  // React.createElement) — those still return React.createElement calls at
  // runtime, they just don't spell "React.createElement" or "<div" in the
  // source text.
  const returnsJsx =
    /return\s*\(?\s*</.test(code) ||
    /React\.createElement\s*\(/.test(code) ||
    /return\s*h\s*\(\s*['"]/.test(code);
  const isClass = /\bclass\s+[A-Za-z0-9_]+/.test(code);
 
  if (hasOnMount || hasOnUnmount || (hasContainerArg && !hasTransformArg)) {
    // CanvasRenderer contract: onMount({ container, props, libs }) / onUpdate({ container, ... }) / onUnmount(...)
    kind = 'canvas';
  } else if (hasOnStartOrOnUpdate && (hasTransformArg || !returnsJsx) && isClass) {
    // ScriptComponent (motion script) contract: onStart/onUpdate({ transform, tween, props })
    kind = 'motion';
  } else if (returnsJsx && !isClass) {
    // ReactRenderer contract: function component returning JSX
    kind = 'react';
  } else if (hasOnStartOrOnUpdate) {
    // Class with onStart/onUpdate but we couldn't confirm the transform arg
    // shape — still far more likely to be a motion script than anything else.
    kind = 'motion';
  }
 
  scriptKindCache.set(code, kind);
  return kind;
}
 
/**
 * Compiles a JS/JSX script into an executable module/class
 */
export function compileScriptModule(scriptCode) {
  if (!scriptCode) return null;
  if (compiledModuleCache.has(scriptCode)) {
    return compiledModuleCache.get(scriptCode);
  }
 
  try {
    const transpiled = transpileJsxToJs(scriptCode);
 
    // Module wrapper providing React, MotionTween, Easing, MathUtils, and Remotion hooks
    const moduleWrapper = `
      let exports = {};
      let module = { exports: {} };
 
      // Helper function to simulate default export
      function exportDefault(target) {
        module.exports.default = target;
        return target;
      }
 
      // h(tag, props, children) -- no-JSX authoring helper. The Script
      // Editor's own placeholder text tells users to write h(tag, props,
      // children) for "React Component (no JSX)" templates instead of
      // angle-bracket JSX, so this must be provided at runtime or every
      // such script throws "h is not defined" the moment it renders.
      const h = React.createElement;
 
      ${transpiled}
 
      // Resolve exported entity
      const result = module.exports.default || module.exports || (typeof CustomComponent !== 'undefined' ? CustomComponent : null);
      return result;
    `;
 
    const compiledFn = new Function(
      'React',
      'MotionTweenContext',
      'Easing',
      'Ease',
      'LoopType',
      'MathUtils',
      'interpolate',
      'spring',
      moduleWrapper
    );
 
    const exportedResult = compiledFn(
      React,
      MotionTweenContext,
      Easing,
      Ease,
      LoopType,
      MathUtils,
      interpolate,
      spring
    );
 
    lastErrorCache.delete(scriptCode);
    compiledModuleCache.set(scriptCode, exportedResult);
    return exportedResult;
  } catch (err) {
    console.warn('Script compilation error:', err);
    lastErrorCache.set(scriptCode, err.message);
    return null;
  }
}
 
/**
 * Deterministically executes a behavior motion script for a GameObject transform
 */
export function executeScriptComponent({
  scriptCode,
  transform,
  localTime = 0,
  clipDuration = 5,
  publicValues = {},
  frame = 0,
  fps = 30,
}) {
  if (!scriptCode) return transform;
 
  try {
    const compiled = compileScriptModule(scriptCode);
    if (!compiled) return transform;
 
    const tweenContext = new MotionTweenContext({ ...transform });
 
    // Transform proxy with vector-friendly sub-properties
    const transformProxy = {
      position: {
        x: transform.x ?? 0,
        y: transform.y ?? 0,
        _isPosition: true,
      },
      scale: {
        x: transform.scaleX ?? 1,
        y: transform.scaleY ?? 1,
        _isScale: true,
      },
      rotation: transform.rotation ?? 0,
      opacity: transform.opacity ?? 1,
    };
 
    const scriptProps = { ...publicValues };
 
    // Instantiate class or run object methods
    let instance = null;
    if (typeof compiled === 'function' && compiled.prototype && compiled.prototype.constructor) {
      try {
        instance = new compiled();
      } catch {
        // Might be a functional component
        instance = null;
      }
    } else if (typeof compiled === 'object' && compiled !== null) {
      instance = compiled;
    }
 
    // 1. Call onStart() / Start() for tween setup
    const onStartFn = instance?.onStart || instance?.Start || compiled?.onStart;
    if (typeof onStartFn === 'function') {
      onStartFn.call(instance, {
        transform: transformProxy,
        tween: tweenContext,
        props: scriptProps,
        time: localTime,
        frame,
        fps,
        duration: clipDuration,
        Math: MathUtils,
      });
    }
 
    // 2. Deterministically evaluate tweens at localTime
    const tweenedTransform = tweenContext.evaluate(localTime, {
      x: transformProxy.position.x,
      y: transformProxy.position.y,
      rotation: transformProxy.rotation,
      scaleX: transformProxy.scale.x,
      scaleY: transformProxy.scale.y,
      opacity: transformProxy.opacity,
    });
 
    transformProxy.position.x = tweenedTransform.x;
    transformProxy.position.y = tweenedTransform.y;
    transformProxy.rotation = tweenedTransform.rotation;
    transformProxy.scale.x = tweenedTransform.scaleX;
    transformProxy.scale.y = tweenedTransform.scaleY;
    transformProxy.opacity = tweenedTransform.opacity;
 
    // 3. Call onUpdate() / Update() for custom frame-based math
    const onUpdateFn = instance?.onUpdate || instance?.Update || compiled?.onUpdate;
    if (typeof onUpdateFn === 'function') {
      onUpdateFn.call(instance, {
        transform: transformProxy,
        props: scriptProps,
        time: localTime,
        frame,
        fps,
        duration: clipDuration,
        Math: MathUtils,
        lerp: MathUtils.lerp,
        clamp: MathUtils.clamp,
        interpolate,
        spring,
      });
    }
 
    return {
      ...transform,
      x: transformProxy.position.x,
      y: transformProxy.position.y,
      rotation: transformProxy.rotation,
      scaleX: transformProxy.scale.x,
      scaleY: transformProxy.scale.y,
      opacity: Math.max(0, Math.min(1, transformProxy.opacity)),
    };
  } catch (err) {
    console.warn('Script execution warning:', err);
    return transform;
  }
}
 
/**
 * Returns the compiled React Component for clips that render custom React / Web UI
 */
export function getCompiledReactComponent(scriptCode) {
  if (!scriptCode) return null;
  const compiled = compileScriptModule(scriptCode);
  if (typeof compiled === 'function') {
    return compiled;
  }
  return null;
}
 
/**
 * Check if a script has an active compilation error
 */
export function getScriptError(scriptCode) {
  return lastErrorCache.get(scriptCode) || null;
}