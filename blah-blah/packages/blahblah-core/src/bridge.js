import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { atomicWriteFile } from './fsutil.js';

export const DEFAULT_BRIDGE_PORT = 9876;
export const DEFAULT_ALLOWED_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'http://localhost:5173',
];
export const BRIDGE_COMMANDS = ['seek', 'reload', 'select', 'play', 'pause', 'render_frame'];

const MAX_BODY_BYTES = 64 * 1024;
const MAX_PENDING_FILES = 100;

/**
 * Checks a bridge command and returns it in canonical form.
 * Throws on unknown commands or bad arguments.
 */
export function validateBridgeCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    throw new Error('Bridge command must be an object like { "type": "seek", "arg": 3.5 }.');
  }
  const { type, arg } = command;
  if (!BRIDGE_COMMANDS.includes(type)) {
    throw new Error(`Unknown bridge command "${type}". Use one of: ${BRIDGE_COMMANDS.join(', ')}.`);
  }
  if (type === 'seek') {
    const t = typeof arg === 'string' && arg.trim() !== '' ? Number(arg) : arg;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
      throw new Error('"seek" needs a time in seconds (a number >= 0) as arg.');
    }
    return { type, arg: t };
  }
  if (type === 'select') {
    if (typeof arg !== 'string' || arg.trim() === '') {
      throw new Error('"select" needs an entity id or name as arg.');
    }
    return { type, arg };
  }
  if (type === 'render_frame') {
    const rawTime =
      arg && typeof arg === 'object' && !Array.isArray(arg)
        ? arg.time
        : arg !== undefined
          ? arg
          : command.time;
    const t = typeof rawTime === 'string' && rawTime.trim() !== '' ? Number(rawTime) : rawTime;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
      throw new Error('"render_frame" needs a time in seconds (a number >= 0).');
    }
    const format =
      (arg && typeof arg === 'object' && arg.format) || command.format || 'png';
    if (format !== 'png') {
      throw new Error('"render_frame" currently only supports format "png".');
    }
    return { type, arg: { time: t, format } };
  }
  return { type };
}

function bridgePaths(projectDir) {
  const root = path.resolve(projectDir, '.aibridge');
  return {
    root,
    inbox: path.join(root, 'inbox'),
    outbox: path.join(root, 'outbox'),
    latest: path.join(root, 'command.json'),
    token: path.join(root, 'token'),
  };
}

/**
 * File-based IPC. Every command gets its own file in
 * <projectDir>/.aibridge/inbox/, so a second command never overwrites a first
 * one that has not been read yet. The most recent command is also kept in
 * <projectDir>/.aibridge/command.json for simple listeners.
 */
export async function sendFileCommand(projectDir, command, options = {}) {
  const clean = validateBridgeCommand(command);
  const paths = bridgePaths(projectDir);
  await fs.mkdir(paths.inbox, { recursive: true });

  const token = await resolveToken({ token: options.token, projectDir });
  const timestamp = Date.now();
  const payload = {
    id: `cmd-${timestamp}-${crypto.randomBytes(4).toString('hex')}`,
    timestamp,
    ...(token ? { token } : {}),
    ...clean,
  };

  const json = JSON.stringify(payload, null, 2);
  await atomicWriteFile(path.join(paths.inbox, `${String(timestamp).padStart(15, '0')}-${payload.id}.json`), json);
  await atomicWriteFile(paths.latest, json);

  // Nobody may be listening: keep the inbox from growing forever.
  const pending = (await fs.readdir(paths.inbox)).filter((f) => f.endsWith('.json')).sort();
  for (const old of pending.slice(0, Math.max(0, pending.length - MAX_PENDING_FILES))) {
    await fs.rm(path.join(paths.inbox, old), { force: true });
  }

  return payload;
}

/**
 * Returns the oldest pending file command (or null). With `consume: true` the
 * command is removed so it is handled only once.
 */
export async function pollFileCommand(projectDir, { consume = false } = {}) {
  const { inbox } = bridgePaths(projectDir);
  let files;
  try {
    files = (await fs.readdir(inbox)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return null;
  }

  for (const file of files) {
    const full = path.join(inbox, file);
    try {
      const command = JSON.parse(await fs.readFile(full, 'utf8'));
      if (consume) await fs.rm(full, { force: true });
      return command;
    } catch {
      // unreadable or half-written entry: drop it and look at the next one
      if (consume) await fs.rm(full, { force: true }).catch(() => {});
    }
  }
  return null;
}

/**
 * For the application side: records the outcome of a command so the sender
 * can read it with waitForResult.
 */
export async function writeFileResult(projectDir, id, result) {
  if (!/^cmd-[\w-]+$/.test(String(id))) throw new Error(`Invalid command id "${id}".`);
  const { outbox } = bridgePaths(projectDir);
  await atomicWriteFile(
    path.join(outbox, `${id}.json`),
    JSON.stringify({ id, timestamp: Date.now(), ...result }, null, 2)
  );
}

/**
 * Waits for the application to answer command `id`. Resolves with the result,
 * or null when `timeoutMs` passes without one.
 */
export async function waitForResult(projectDir, id, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  if (!/^cmd-[\w-]+$/.test(String(id))) throw new Error(`Invalid command id "${id}".`);
  const file = path.join(bridgePaths(projectDir).outbox, `${id}.json`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      // not there yet
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function resolveToken({ token, projectDir } = {}) {
  if (token) return token;
  if (process.env.BLAHBLAH_BRIDGE_TOKEN) return process.env.BLAHBLAH_BRIDGE_TOKEN;
  if (projectDir) {
    try {
      return (await fs.readFile(bridgePaths(projectDir).token, 'utf8')).trim();
    } catch {
      // no token file
    }
  }
  return null;
}

/**
 * Sends a live command to a running BlahBlah bridge server over HTTP.
 * The server requires the token it printed / wrote to
 * <projectDir>/.aibridge/token (or BLAHBLAH_BRIDGE_TOKEN).
 */
export async function sendHttpCommand(command, port = DEFAULT_BRIDGE_PORT, options = {}) {
  const clean = validateBridgeCommand(command);
  const token = await resolveToken(options);
  const timeoutMs = options.timeoutMs ?? 2000;
  const portNumber = Number(port);

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(clean);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const req = http.request(
      { hostname: '127.0.0.1', port: portNumber, path: '/command', method: 'POST', headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = { raw: body };
          }
          if (res.statusCode >= 400) {
            reject(new Error(`Bridge rejected the command (HTTP ${res.statusCode}): ${parsed.error || body}`));
          } else {
            resolve(parsed);
          }
        });
      }
    );

    // `timeout` in http.request only emits an event; the request must be destroyed by hand.
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`no answer within ${timeoutMs} ms`)));
    req.on('error', (err) => {
      reject(new Error(`Could not connect to BlahBlah Live Bridge on port ${portNumber}: ${err.message}`));
    });

    req.write(data);
    req.end();
  });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Starts the bridge HTTP server on 127.0.0.1.
 *
 * Security: every request must carry the bearer token, requests from browsers
 * are refused unless their Origin is listed in `allowedOrigins` (so a random
 * web page cannot drive the editor), and the Host header must be a loopback
 * name (DNS-rebinding guard).
 */
export function startBridgeServer({
  port = DEFAULT_BRIDGE_PORT,
  onCommand = null,
  token = crypto.randomBytes(24).toString('hex'),
  projectDir = null,
  allowedOrigins = DEFAULT_ALLOWED_ORIGINS,
} = {}) {
  let latestCommand = null;
  const subscribers = new Set();
  const hosts = new Set();

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    const actualPort = server.address()?.port ?? port;
    const hostOk = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, `[::1]:${actualPort}`].includes(
      String(req.headers.host || '')
    );
    if (!hostOk) return reply(403, { error: 'Forbidden host.' });

    if (origin !== undefined) {
      if (!allowedOrigins.includes(origin)) return reply(403, { error: 'Origin not allowed.' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), token)) {
      return reply(401, { error: 'Missing or invalid bridge token.' });
    }

    const url = String(req.url || '').split('?')[0];

    if (req.method === 'GET' && url === '/status') {
      return reply(200, {
        status: 'running',
        port: actualPort,
        listeners: subscribers.size + (onCommand ? 1 : 0),
        latestCommand,
      });
    }

    if (req.method === 'POST' && url === '/command') {
      let body = '';
      let tooLarge = false;
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
          tooLarge = true;
          req.destroy();
        }
      });
      req.on('end', () => {
        if (tooLarge) return;
        let cmd;
        try {
          cmd = validateBridgeCommand(JSON.parse(body));
        } catch (err) {
          return reply(400, { error: err.message });
        }

        latestCommand = { ...cmd, timestamp: Date.now() };
        let failures = 0;
        for (const handler of [...(onCommand ? [onCommand] : []), ...subscribers]) {
          try {
            handler(latestCommand);
          } catch {
            failures++;
          }
        }
        const listeners = subscribers.size + (onCommand ? 1 : 0);
        reply(200, { ok: true, delivered: listeners > 0, listeners, handlerFailures: failures, command: latestCommand });
      });
      return;
    }

    reply(404, { error: 'Not found.' });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', async () => {
      const actualPort = server.address().port;
      hosts.add(actualPort);
      try {
        if (projectDir) {
          const { token: tokenFile } = bridgePaths(projectDir);
          await atomicWriteFile(tokenFile, token);
          await fs.chmod(tokenFile, 0o600).catch(() => {});
        }
      } catch (err) {
        server.close();
        reject(err);
        return;
      }
      resolve({
        server,
        port: actualPort,
        token,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections?.();
          }),
        on: (fn) => {
          subscribers.add(fn);
          return () => subscribers.delete(fn);
        },
      });
    });
  });
}
