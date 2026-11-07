/**
 * Worker-side runtime for canvas scripts.
 *
 * The main thread sends the esbuild-compiled CommonJS source (not the loaded
 * class, which cannot cross the boundary), this module evaluates it with the
 * same injected helpers as the main-thread evaluator, and then animates the
 * instance against the OffscreenCanvas transferred from the editor.
 *
 * `container` is null here on purpose: a script that needs the live DOM cannot
 * run in a worker, and canvasRunner detects those before choosing this path
 * (and falls back to the main thread if evaluation still fails).
 */
import React from 'react';
import { PROP_HELPER_NAMES, propHelperValues } from './scriptProps.js';
import { Tween } from './motionTween.js';
import { getSandboxScope } from './scriptSandbox.js';

let instance = null;
let canvas = null;

function reply(type, id) {
  self.postMessage({ id, type: `${type}_ok` });
}

function evaluate(code) {
  const sandbox = getSandboxScope();
  const factory = new Function(
    'React',
    'MotionTweenContext',
    'Easing',
    'Ease',
    'LoopType',
    'MathUtils',
    'interpolate',
    'spring',
    ...PROP_HELPER_NAMES,
    ...sandbox.names,
    `'use strict';
     const module = { exports: {} };
     const exports = module.exports;
     ${code}
     const ownKeys = module.exports && typeof module.exports === 'object' ? Object.keys(module.exports) : [];
     if (!ownKeys.includes('default')) {
       throw new Error('Script has no default export.');
     }
     return module.exports.default;`
  );

  return factory(
    React,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    ...propHelperValues(),
    ...sandbox.values,
  );
}

function withRuntimeArgs(args) {
  return {
    ...(args || {}),
    container: null,
    tween: Tween,
    Tween,
  };
}

self.onmessage = (event) => {
  const { id, type, payload } = event.data || {};
  try {
    if (type === 'init') {
      const exported = evaluate(String(payload?.code || ''));
      instance = typeof exported === 'function' && exported.prototype ? new exported() : exported;
      reply(type, id);
      return;
    }

    if (type === 'set_canvas') {
      canvas = payload?.canvas || null;
      if (instance && canvas) {
        instance.canvas = canvas;
        instance.ctx = canvas.getContext('2d');
        // Ensure the DrawContext wrapper exists now that ctx is available.
        // CanvasComponent._ensureDraw() creates instance.draw from this.ctx;
        // call it here because onMount runs before set_canvas in the host
        // handshake, so the base class never got a chance to create it.
        if (typeof instance._ensureDraw === 'function') {
          instance._ensureDraw();
        }
      }
      reply(type, id);
      return;
    }

    if (type === 'mount') {
      if (instance) {
        if (typeof payload?.canvasWidth === 'number') instance.canvasWidth = payload.canvasWidth;
        if (typeof payload?.canvasHeight === 'number') instance.canvasHeight = payload.canvasHeight;
        if (typeof payload?.aspect === 'number') instance.aspect = payload.aspect;
      }
      if (typeof instance?.onMount === 'function') {
        instance.onMount({
          ...withRuntimeArgs(payload),
          signal: new AbortController().signal,
        });
      }
      // After onMount, ensure draw is wired up (ctx may now be set by the base class).
      if (instance && typeof instance._ensureDraw === 'function') {
        instance._ensureDraw();
      }
      reply(type, id);
      return;
    }

    if (type === 'seek') {
      if (typeof instance?.onSeek === 'function') instance.onSeek(withRuntimeArgs(payload));
      reply(type, id);
      return;
    }

    if (type === 'update') {
      if (typeof instance?.onUpdate === 'function') {
        // Ensure draw is available before every frame, in case onMount didn't
        // have a chance to create it (e.g. first frame right after set_canvas).
        if (instance.ctx && typeof instance._ensureDraw === 'function') {
          instance._ensureDraw();
        }
        // Pass `draw` in the args so scripts that destructure `{ draw }` from
        // onUpdate args get the DrawContext — same as the main-thread path in
        // canvasRunner.js (line: `const draw = mounted.instance?.draw || null`).
        const draw = instance.draw || null;
        instance.onUpdate({ ...withRuntimeArgs(payload), draw });
      }
      reply(type, id);
      return;
    }

    if (type === 'unmount') {
      if (typeof instance?.onUnmount === 'function') instance.onUnmount({ container: null });
      instance = null;
      canvas = null;
      reply(type, id);
      return;
    }

    self.postMessage({ id, type: 'error', error: `Unknown worker message: ${String(type)}` });
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err?.stack || err?.message || err) });
  }
};
