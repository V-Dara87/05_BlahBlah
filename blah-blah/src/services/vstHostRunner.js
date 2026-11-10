/**
 * Thin, validated bridge to the Windows VST3 host sidecar.
 *
 * The webview never loads plugin binaries. Every operation is an argv list
 * built here, sent through the Tauri command that owns the sidecar allowlist
 * and process registry, and parsed back from the JSON-lines protocol.
 */

import { invoke, isTauri } from '@tauri-apps/api/core';

export class VstHostError extends Error {
  constructor(message, code = 'VSTHOST_ERROR', plugin = null) {
    super(message);
    this.name = 'VstHostError';
    this.code = code;
    this.plugin = plugin;
  }
}

export function isVstHostRuntime() {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

export function parseVstHostOutput(stdout) {
  const events = [];
  let result = null;
  let error = null;
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== '{') continue;
    try {
      const event = JSON.parse(trimmed);
      events.push(event);
      if (event.event === 'result') result = event;
      if (event.event === 'error') {
        error = new VstHostError(event.message || 'VST host error', event.code || 'VSTHOST_ERROR', event.plugin || null);
      }
    } catch {
      // A plugin's own stdout is redirected to stderr by the sidecar; ignore
      // any stray non-JSON line rather than failing the whole operation.
    }
  }
  return { events, result, error };
}

function newSessionId() {
  try {
    return `vst-${crypto.randomUUID()}`;
  } catch {
    return `vst-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export async function cancelVstHost(sessionId) {
  if (!sessionId || !isVstHostRuntime()) return false;
  try {
    return await invoke('cancel_process', { sessionId });
  } catch {
    return false;
  }
}

/**
 * Run one sidecar command. `timeoutMs` is a host-side watchdog: when it fires
 * we cancel the registered child, which unblocks the invoke call with the
 * sidecar's cancelled error.
 */
export async function runVstHost(args, { sessionId = newSessionId(), timeoutMs = 0, onProgress } = {}) {
  if (!isVstHostRuntime()) {
    throw new VstHostError('VST hosting is only available in the desktop app.', 'NOT_DESKTOP');
  }

  let unlisten = null;
  let timer = null;
  if (onProgress) {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen('vsthost-progress', (event) => {
        if (event?.payload?.session_id && event.payload.session_id !== sessionId) return;
        const line = event?.payload?.line;
        if (line) onProgress(line);
      });
    } catch {
      // Progress is a nicety; the command still works without it.
    }
  }
  if (timeoutMs > 0) {
    timer = setTimeout(() => { cancelVstHost(sessionId); }, timeoutMs);
  }

  try {
    const stdout = await invoke('run_vsthost', { args, sessionId });
    const parsed = parseVstHostOutput(stdout);
    if (parsed.error) throw parsed.error;
    return { ...parsed, stdout, sessionId };
  } catch (error) {
    if (error instanceof VstHostError) throw error;
    throw new VstHostError(String(error?.message || error), 'VSTHOST_PROCESS_FAILED');
  } finally {
    if (timer) clearTimeout(timer);
    if (unlisten) unlisten();
  }
}

export async function getVstHostInfo() {
  if (!isVstHostRuntime()) {
    throw new VstHostError('VST hosting is only available in the desktop app.', 'NOT_DESKTOP');
  }
  let stdout;
  try {
    stdout = await invoke('vsthost_info');
  } catch (error) {
    throw new VstHostError(String(error?.message || error), 'VSTHOST_UNAVAILABLE');
  }
  const parsed = parseVstHostOutput(stdout);
  if (parsed.error) throw parsed.error;
  if (!parsed.result) throw new VstHostError('VST host returned no info.', 'VSTHOST_BAD_OUTPUT');
  return parsed.result;
}

export async function scanVstPlugins({ dirs = [], perPluginTimeoutMs = 30000, onProgress } = {}) {
  const args = ['scan', '--per-plugin-timeout-ms', String(perPluginTimeoutMs)];
  for (const dir of dirs) args.push('--dir', dir);
  // A scan is one in-process pass. The app-side watchdog is deliberately
  // generous for default folders; a single malicious plugin cannot hang the
  // app because the child is cancelled and killed.
  const { result } = await runVstHost(args, {
    timeoutMs: Math.max(90000, perPluginTimeoutMs * Math.max(1, dirs.length)),
    onProgress,
  });
  if (!result) throw new VstHostError('VST scan returned no result.', 'VSTHOST_BAD_OUTPUT');
  return {
    dirs: Array.isArray(result.dirs) ? result.dirs : dirs,
    plugins: Array.isArray(result.plugins) ? result.plugins : [],
    failed: Array.isArray(result.failed) ? result.failed : [],
    elapsedMs: Number(result.elapsedMs) || 0,
  };
}

export async function processVstChain({
  chainPath,
  inputPath,
  outputPath,
  sampleRate = 48000,
  discardHeadMs = 0,
  tailMaxMs = 10000,
  onProgress,
}) {
  const args = [
    'process',
    '--chain', chainPath,
    '--in', inputPath,
    '--out', outputPath,
    '--sample-rate', String(Math.round(sampleRate)),
    '--discard-head-ms', String(Math.max(0, Math.round(discardHeadMs))),
    '--tail-max-ms', String(Math.max(0, Math.round(tailMaxMs))),
  ];
  const { result } = await runVstHost(args, { onProgress });
  if (!result) throw new VstHostError('VST process returned no result.', 'VSTHOST_BAD_OUTPUT');
  return result;
}

export async function capturePluginState({ pluginPath, classId, stateFile }) {
  const args = ['state', '--plugin', pluginPath, '--class-id', classId, '--state-out', stateFile];
  const { result } = await runVstHost(args, { timeoutMs: 60000 });
  if (!result) throw new VstHostError('VST state capture returned no result.', 'VSTHOST_BAD_OUTPUT');
  return result;
}

export async function openPluginEditor({ pluginPath, classId, stateFile, stateOut, title }) {
  const args = [
    'editor',
    '--plugin', pluginPath,
    '--class-id', classId,
    '--state-out', stateOut,
  ];
  if (stateFile) args.push('--state-in', stateFile);
  if (title) args.push('--title', title);
  const { result } = await runVstHost(args, { onProgress: null });
  if (!result) throw new VstHostError('VST editor returned no result.', 'VSTHOST_BAD_OUTPUT');
  return result;
}
