/**
 * ScriptWorkerHost — the single execution host for user scripts that can run
 * off the UI thread.
 *
 * Scripts are arbitrary code shipped inside a project file. Running them on the
 * main thread means a `while (true) {}` freezes the editor and gives the script
 * access to the app's real globals. Canvas-kind scripts are pure per-frame
 * drawing, so they are executed in a dedicated module Worker against an
 * OffscreenCanvas instead (see canvasRunner.js for the fallback rules).
 *
 * Every call has a watchdog: if the worker does not answer within its budget it
 * is terminated immediately and the caller gets a `ScriptHangError`, which
 * turns an infinite loop into one clear Console message instead of a dead app.
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

export class ScriptWorkerHost {
  constructor({ scriptCode, scriptName = '', timeoutMs = 1000, workerFactory = null }) {
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
    } else if (typeof Worker !== 'undefined') {
      // A module worker, so the runtime can import the prop helpers, the tween
      // helpers and the sandbox wrapper instead of duplicating them.
      this.worker = new Worker(new URL('./scriptWorkerRuntime.js', import.meta.url), {
        type: 'module',
        name: 'blahblah-script',
      });
    }

    if (this.worker) {
      this.worker.onmessage = (e) => this._handleMessage(e.data);
      this.worker.onerror = (err) => this._handleError(err);
    }
  }

  _handleMessage(data) {
    const { id, type, error } = data || {};
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
      cb.reject(err instanceof Error ? err : new Error(String(err?.message || err)));
    }
    this.pendingCallbacks.clear();
  }

  /** Send a message to the worker with an enforced watchdog timeout. */
  callWorker(type, payload, transferables = [], timeoutMs = this.timeoutMs) {
    if (this.isTerminated || this.isHanging) {
      return Promise.reject(new Error('Worker is inactive (hung or terminated).'));
    }
    if (!this.worker) {
      return Promise.reject(new Error('No worker available in this environment.'));
    }

    const id = ++this.messageId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.isHanging = true;
        this.terminate();
        reject(new ScriptHangError(this.scriptName, timeoutMs));
      }, timeoutMs);

      this.pendingCallbacks.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ id, type, payload }, transferables);
      } catch (err) {
        clearTimeout(timer);
        this.pendingCallbacks.delete(id);
        reject(err);
      }
    });
  }

  /** Evaluate and instantiate the script inside the worker. */
  async initScript() {
    return this.callWorker('init', { code: this.scriptCode, scriptName: this.scriptName }, [], 10000);
  }

  async attachOffscreenCanvas(offscreenCanvas) {
    return this.callWorker('set_canvas', { canvas: offscreenCanvas }, [offscreenCanvas], 5000);
  }

  async mount(args) {
    return this.callWorker('mount', args, [], 10000);
  }

  async seek(args) {
    return this.callWorker('seek', args, [], this.timeoutMs);
  }

  async update(args) {
    return this.callWorker('update', args, [], this.timeoutMs);
  }

  async unmount() {
    try {
      await this.callWorker('unmount', {}, [], 1000);
    } catch {
      // The worker may already be gone; unmount is best-effort.
    }
  }

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
