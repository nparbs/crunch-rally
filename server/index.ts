// Crunch Rally server: serves the game page and runs race rooms over WebSocket.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { CODE_CHARS, PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '../src/net/protocol';
import { Room } from '../src/net/room';
import { DT } from '../src/sim/race';

declare const __APP_VERSION__: string;

const PORT = Number(process.env.PORT ?? 8792);
const STATIC_DIR = path.resolve(process.env.STATIC_DIR ?? 'dist');
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const IP_HEADER = (process.env.CLIENT_IP_HEADER ?? '').toLowerCase();
const MAX_PER_IP = 6;
const MAX_ONLINE = Number(process.env.MAX_ONLINE ?? 80);
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 20);

const rooms = new Map<string, Room>();
let online = 0;
let nextId = 1;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(STATIC_DIR, '.' + rel);
  if (!file.startsWith(STATIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const hashed = rel.startsWith('/assets/');
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'content-length': st.size,
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    const racing = [...rooms.values()].filter((r) => r.race).length;
    res.end(JSON.stringify({ ok: true, version: __APP_VERSION__, online, rooms: rooms.size, racing }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

function newCode(): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

const perIp = new Map<string, number>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

function clientIp(req: http.IncomingMessage): string {
  const h = IP_HEADER ? req.headers[IP_HEADER] : undefined;
  const v = Array.isArray(h) ? h[0] : h;
  return (v?.split(',')[0].trim() || req.socket.remoteAddress) ?? '?';
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const origin = req.headers.origin ?? '';
  const ip = clientIp(req);
  if (url.pathname !== '/ws' || (ALLOWED.length && !ALLOWED.includes(origin)) || (perIp.get(ip) ?? 0) >= MAX_PER_IP || online >= MAX_ONLINE) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    online++;
    const id = 'p' + (nextId++).toString(36);
    const send = (m: ServerMsg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    };
    let room: Room | null = null;
    // Token bucket: kart reports arrive 20 times a second; floods get cut off.
    let tokens = 80;
    let last = Date.now();
    let alive = true;
    ws.on('pong', () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 30_000);

    ws.on('message', (data) => {
      const now = Date.now();
      tokens = Math.min(80, tokens + ((now - last) / 1000) * 40);
      last = now;
      if (--tokens < 0) {
        ws.close(1008, 'Too many messages');
        return;
      }
      let m: ClientMsg;
      try {
        m = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return;
      try {
        if (m.t === 'create' || m.t === 'join') {
          if (room) return;
          if (m.v !== PROTOCOL_VERSION) {
            send({ t: 'error', msg: 'The game has been updated. Refresh the page.', refresh: true });
            return;
          }
          if (m.t === 'create') {
            if (rooms.size >= MAX_ROOMS) {
              send({ t: 'error', msg: 'The server is full right now. Try again soon.' });
              return;
            }
            room = new Room(newCode());
            rooms.set(room.code, room);
          } else {
            const r = rooms.get(String(m.code).toUpperCase().trim());
            if (!r) {
              send({ t: 'error', msg: 'No room with that code.' });
              return;
            }
            room = r;
          }
          if (!room.add({ id, send }, m.name, m.char)) {
            send({ t: 'error', msg: 'That room is full.' });
            room = null;
          }
          return;
        }
        if (m.t === 'leave') {
          room?.remove(id);
          room = null;
          return;
        }
        room?.handle(id, m);
      } catch (e) {
        console.error('handler error', e);
      }
    });

    ws.on('close', () => {
      clearInterval(ping);
      online--;
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
      room?.remove(id);
    });
  });
});

// Fixed 60 Hz for every room, catching up after a slow moment but never spiralling.
const TICK = DT * 1000;
let lastT = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += now - lastT;
  lastT = now;
  let n = 0;
  while (acc >= TICK && n < 8) {
    for (const r of rooms.values()) {
      try {
        r.tick(DT);
      } catch (e) {
        console.error('tick error', e);
        r.race = null;
      }
    }
    acc -= TICK;
    n++;
  }
  if (acc > 250) acc = 0;
}, 4);

// Drop rooms that have been empty for a minute.
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.size > 0) r.emptySince = 0;
    else if (!r.emptySince) r.emptySince = now;
    else if (now - r.emptySince > 60_000) rooms.delete(code);
  }
}, 10_000);

server.listen(PORT, () => {
  console.log(`Crunch Rally v${__APP_VERSION__} on :${PORT}, static from ${STATIC_DIR}`);
});

const shutdown = () => {
  server.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
