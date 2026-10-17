/**
 * ScriptWorkerHost - Web Worker sandbox host with freeze-prevention watchdog.
 *
 * Problem:
 * User scripts run in the UI thread can freeze the entire application if an author
 * writes an infinite loop like `while (true) {}` or `for (let i = 0; i < 1e12; i++)`.
 *
 * Solution:
 * 1. Offload script execution to a dedicated Web Worker using OffscreenCanvas.
 * 2. The main thread sends frame update signals and waits with a strict Watchdog Timer (default 300ms).
 * 3. If the worker does not respond within the budget, the host forcefully invokes
 *    `worker.terminate()`, instantly killing the runaway thread without freezing the UI.
 * 4. A clean error is logged and the script is marked as hanging.
 */

export class ScriptHangError extends Error {
  constructor(scriptName, timeoutMs) {
    super(
      `[BlahBlah Watchdog] Script "${scriptName || 'script'}" froze (exceeded ${timeoutMs}ms budget). ` +
      `The execution thread was forcefully terminated to prevent the editor from freezing.`
    );
    this.name = 'ScriptHangError';
  }
}

/**
 * Source code for the inline worker runner.
 * Evaluates the script in worker scope and executes onUpdate using an OffscreenCanvas.
 */
export const WORKER_BOOTSTRAP_CODE = `
let instance = null;
let canvas = null;
let ctx = null;

self.onmessage = async (e) => {
  const { type, id, payload } = e.data;

  if (type === 'init') {
    try {
      const { code, scriptName } = payload;
      // Simple wrapper in worker scope
      const moduleFn = new Function('exports', 'module', code);
      const exports = {};
      const module = { exports };
      moduleFn(exports, module);
      const Comp = module.exports.default || module.exports;
      if (typeof Comp === 'function' && Comp.prototype) {
        instance = new Comp();
      } else {
        instance = Comp;
      }
      self.postMessage({ type: 'init_ok', id });
    } catch (err) {
      self.postMessage({ type: 'error', id, error: String(err?.message || err) });
    }
  } else if (type === 'set_canvas') {
    canvas = payload.canvas;
    ctx = canvas.getContext('2d');
    if (instance) {
      instance.canvas = canvas;
      instance.ctx = ctx;
      if (typeof instance.onMount === 'function') {
        try {
          instance.onMount({ container: null, canvasWidth: canvas.width, canvasHeight: canvas.height });
        } catch (err) {
          self.postMessage({ type: 'error', id, error: String(err?.message || err) });
          return;
        }
      }
    }
    self.postMessage({ type: 'canvas_ok', id });
  } else if (type === 'update') {
    if (!instance) {
      self.postMessage({ type: 'update_ok', id });
      return;
    }
    try {
      if (typeof instance.onUpdate === 'function') {
        instance.onUpdate(payload);
      }
      self.postMessage({ type: 'update_ok', id });
    } catch (err) {
      self.postMessage({ type: 'error', id, error: String(err?.message || err) });
    }
  }
};
`;

export class ScriptWorkerHost {
  constructor({ scriptCode, scriptName = '', timeoutMs = 300, workerFactory = null }) {
    this.scriptCode = scriptCode;
    this.scriptName = scriptName;
    this.timeoutMs = timeoutMs;
    this.workerFactory = workerFactory;
    this.worker = null;
    this.messageId = 0;
    this.pendingCallbacks = new Map();
    this.isTerminated = false;
    this.isHanging = false;

    this._initWorker();
  }

  _initWorker() {
    if (this.workerFactory) {
      this.worker = this.workerFactory();
    } else if (typeof Blob !== 'undefined' && typeof Worker !== 'undefined' && typeof URL !== 'undefined') {
      const blob = new Blob([WORKER_BOOTSTRAP_CODE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
    }

    if (this.worker) {
      this.worker.onmessage = (e) => this._handleMessage(e.data);
      this.worker.onerror = (err) => this._handleError(err);
    }
  }

  _handleMessage(data) {
    const { id, type, error } = data;
    const cb = this.pendingCallbacks.get(id);
    if (!cb) return;

    clearTimeout(cb.timer);
    this.pendingCallbacks.delete(id);

    if (type === 'error') {
      cb.reject(new Error(error));
    } else {
      cb.resolve(data);
    }
  }

  _handleError(err) {
    for (const [, cb] of this.pendingCallbacks) {
      clearTimeout(cb.timer);
      cb.reject(err);
    }
    this.pendingCallbacks.clear();
  }

  /**
   * Send a message to the worker with an enforced watchdog timeout.
   */
  callWorker(type, payload, transferables = []) {
    if (this.isTerminated || this.isHanging) {
      return Promise.reject(new Error(`Worker is inactive (hung or terminated).`));
    }
    if (!this.worker) {
      return Promise.reject(new Error(`No worker available in this environment.`));
    }

    const id = ++this.messageId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // WATCHDOG FIRED! The worker is frozen in an infinite loop!
        this.isHanging = true;
        this.terminate();
        const hangErr = new ScriptHangError(this.scriptName, this.timeoutMs);
        reject(hangErr);
      }, this.timeoutMs);

      this.pendingCallbacks.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, payload }, transferables);
    });
  }

  /**
   * Initializes script code inside the worker.
   */
  async initScript() {
    return this.callWorker('init', { code: this.scriptCode, scriptName: this.scriptName });
  }

  /**
   * Passes an OffscreenCanvas to the worker for drawing.
   */
  async attachOffscreenCanvas(offscreenCanvas) {
    return this.callWorker('set_canvas', { canvas: offscreenCanvas }, [offscreenCanvas]);
  }

  /**
   * Triggers an update with full watchdog timeout protection.
   */
  async update(args) {
    return this.callWorker('update', args);
  }

  /**
   * Immediately terminates the worker, killing any infinite loop instantly.
   */
  terminate() {
    this.isTerminated = true;
    for (const [, cb] of this.pendingCallbacks) {
      clearTimeout(cb.timer);
    }
    this.pendingCallbacks.clear();
    if (this.worker && typeof this.worker.terminate === 'function') {
      this.worker.terminate();
    }
    this.worker = null;
  }
}
