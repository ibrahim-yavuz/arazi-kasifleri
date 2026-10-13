/**
 * Production server: serves the built game (dist/) and the multiplayer rooms (WebSocket
 * at /ws) on one port. Configure with PORT (default 8787) and STATIC_DIR (default ./dist).
 */
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { ClientMessage } from '../src/net/protocol';
import { RoomManager } from './RoomManager';

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? 'dist');
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_MESSAGES_PER_SECOND = 80;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = join(STATIC_DIR, rel);
  // Path traversal guard.
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('Not built: run npm run build');
    return;
  }
  const ext = extname(file);
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

export async function startServer(port = PORT): Promise<{ close(): Promise<void>; port: number; rooms: RoomManager }> {
  const rooms = new RoomManager();
  const http = createServer(serveStatic);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const id = randomUUID().slice(0, 8);
    alive.set(ws, true);
    let windowStart = Date.now();
    let count = 0;
    rooms.connect({
      id,
      name: 'Kaşif',
      roomCode: null,
      send: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    });
    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', (data) => {
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > MAX_MESSAGES_PER_SECOND) return;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data)) as ClientMessage;
      } catch {
        return;
      }
      rooms.handle(id, msg);
    });
    ws.on('close', () => rooms.disconnect(id));
    ws.on('error', () => rooms.disconnect(id));
  });

  const timer = setInterval(() => {
    rooms.tick();
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 15000);
  const tick = setInterval(() => rooms.tick(), 1000);

  await new Promise<void>((done) => http.listen(port, done));
  const addr = http.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    port: actualPort,
    rooms,
    close: () =>
      new Promise<void>((done) => {
        clearInterval(timer);
        clearInterval(tick);
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        http.close(() => done());
      }),
  };
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  void startServer().then((s) => console.log(`[arazi-kasifleri] http://localhost:${s.port}  (static: ${STATIC_DIR}, rooms: ws /ws)`));
}
