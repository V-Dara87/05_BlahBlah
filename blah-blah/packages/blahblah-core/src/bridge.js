import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

export const DEFAULT_BRIDGE_PORT = 9876;

/**
 * File-based IPC: Writes a command to <projectDir>/.aibridge/command.json
 */
export async function sendFileCommand(projectDir, command) {
  const bridgeDir = path.resolve(projectDir, '.aibridge');
  await fs.mkdir(bridgeDir, { recursive: true });

  const payload = {
    id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    ...command,
  };

  const commandFilePath = path.join(bridgeDir, 'command.json');
  await fs.writeFile(commandFilePath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

/**
 * Reads and clears the latest file-based command if present.
 */
export async function pollFileCommand(projectDir) {
  const commandFilePath = path.resolve(projectDir, '.aibridge', 'command.json');
  try {
    const raw = await fs.readFile(commandFilePath, 'utf8');
    const command = JSON.parse(raw);
    return command;
  } catch {
    return null;
  }
}

/**
 * Sends a live command to a running BlahBlah bridge server over HTTP.
 */
export async function sendHttpCommand(command, port = DEFAULT_BRIDGE_PORT) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(command);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/command',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 2000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ ok: true, raw: body });
          }
        });
      }
    );

    req.on('error', (err) => {
      reject(new Error(`Could not connect to BlahBlah Live Bridge on port ${port}: ${err.message}`));
    });

    req.write(data);
    req.end();
  });
}

/**
 * Starts a lightweight Bridge HTTP server on local machine.
 */
export function startBridgeServer({ port = DEFAULT_BRIDGE_PORT, onCommand = () => {} } = {}) {
  let latestCommand = null;
  const subscribers = new Set();

  const server = http.createServer((req, res) => {
    // CORS headers for web/Tauri app
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'running', port, latestCommand }));
      return;
    }

    if (req.method === 'POST' && req.url === '/command') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const cmd = JSON.parse(body);
          latestCommand = { ...cmd, timestamp: Date.now() };
          onCommand(latestCommand);
          for (const sub of subscribers) {
            sub(latestCommand);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, command: latestCommand }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        port,
        close: () => server.close(),
        on: (fn) => subscribers.add(fn),
      });
    });
    server.on('error', reject);
  });
}
