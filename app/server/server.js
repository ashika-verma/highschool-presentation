/**
 * server.js — WebSocket + HTTP server
 *
 * Stack: Node.js, no frameworks.
 * Dependencies: ws (WebSocket), node-fetch or native fetch for WiZ API
 *
 * Install:
 *   npm install ws
 *
 * Run:
 *   node server/server.js
 *   # or: HOST_KEY=yourkey WIZ_IP=192.168.1.x node server/server.js
 *
 * WiZ bulb control:
 *   WiZ uses a local UDP API. We send JSON commands to port 38899.
 *   No cloud needed — works over LAN.
 *   Find your bulb IP in the WiZ app → Device Settings.
 *
 * WebSocket message schema (client → server):
 *   { type: 'join',          name, hex }
 *   { type: 'color',         name, hex }
 *   { type: 'reaction',      name, emoji }
 *   { type: 'text_response', name, text }
 *   { type: 'question',      name, text }
 *   { type: 'host_join',     key }
 *   { type: 'host_color',    hex, key }     — host only, skips student vote
 *   { type: 'mode',          mode, key }    — host only
 *
 * WebSocket message schema (server → client):
 *   { type: 'welcome',       mode, count, totalColorChanges, roomColor, photos, ... }
 *   { type: 'joined',        count }
 *   { type: 'join',          name, count }
 *   { type: 'color',         name, hex }
 *   { type: 'reaction',      name, emoji }
 *   { type: 'text_response', name, text, hex }
 *   { type: 'question',      name, text, hex }
 *   { type: 'mode',          mode }
 *   { type: 'demo_start' }
 */

'use strict';

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const dgram   = require('dgram');
const { WebSocketServer, WebSocket } = require('ws');

// ─── Config ────────────────────────────────────────────────────────────────

const PORT      = parseInt(process.env.PORT ?? '3000', 10);
const HOST_KEY  = process.env.HOST_KEY ?? 'ashika';
const WIZ_IPS   = (process.env.WIZ_IPS ?? '').split(',').filter(Boolean);
// Example: WIZ_IPS=192.168.1.100,192.168.1.101
const WIZ_PORT  = 38899;

const PUBLIC_DIR = path.join(__dirname, '../public');

// ─── App state ─────────────────────────────────────────────────────────────

const appState = {
  mode: 'lobby',
  roomColorHex: '#FF6EB4',
  totalColorChanges: 0,
  clients: new Map(),   // ws → { name, hex, isHost, colorsSent }
  questions: [],
  textResponses: [],
  photos: buildPhotoList(),
};

// ─── Photo list ────────────────────────────────────────────────────────────

function buildPhotoList() {
  // Looks for images in /photos/highschool/ and /photos/college/
  const photoRoot = path.join(__dirname, '../../photos');
  const results = [];

  for (const folder of ['highschool', 'college']) {
    const dir = path.join(photoRoot, folder);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir)
      .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
      .sort();

    files.forEach(file => {
      results.push({
        src:     `/photos/${folder}/${file}`,
        alt:     file.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        caption: folder === 'highschool' ? '⭐ CSHS ⭐' : '🎓 MIT 🎓',
      });
    });
  }

  return results;
}

// ─── WiZ bulb UDP ──────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function sendToWiz(hex) {
  if (WIZ_IPS.length === 0) return;

  const { r, g, b } = hexToRgb(hex);
  const msg = JSON.stringify({
    method: 'setPilot',
    params: { r, g, b, dimming: 90 },
  });

  const client = dgram.createSocket('udp4');
  const buf = Buffer.from(msg);

  WIZ_IPS.forEach(ip => {
    client.send(buf, 0, buf.length, WIZ_PORT, ip.trim(), (err) => {
      if (err) console.error(`[wiz] UDP error to ${ip}:`, err.message);
    });
  });

  // Close after all sends complete
  setTimeout(() => client.close(), 500);
}

// ─── HTTP server + static file serving ─────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  // ── REST: host auth check ──
  if (req.method === 'POST' && pathname === '/auth') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { key } = JSON.parse(body);
        if (key === HOST_KEY) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false }));
        }
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  // ── REST: state snapshot ──
  if (req.method === 'GET' && pathname === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      mode: appState.mode,
      roomColorHex: appState.roomColorHex,
      totalColorChanges: appState.totalColorChanges,
      count: appState.clients.size,
    }));
    return;
  }

  // ── /host → serve host.html ──
  if (pathname === '/host' || pathname === '/host.html') {
    serveFile(res, path.join(PUBLIC_DIR, 'host.html'));
    return;
  }

  // ── Photos: serve from /photos/ directory ──
  if (pathname.startsWith('/photos/')) {
    const photoPath = path.join(__dirname, '../..', pathname);
    // Prevent path traversal
    if (!photoPath.startsWith(path.join(__dirname, '../../photos'))) {
      res.writeHead(403); res.end(); return;
    }
    serveFile(res, photoPath);
    return;
  }

  // ── Static files ──
  let filePath;
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  } else {
    filePath = path.join(PUBLIC_DIR, pathname);
    // Prevent path traversal outside public dir
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403); res.end(); return;
    }
  }

  serveFile(res, filePath);
});

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] ?? 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

// ─── WebSocket server ──────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (socket) => {
  // Register new connection with blank state
  appState.clients.set(socket, { name: null, hex: null, isHost: false, colorsSent: 0 });

  // Send welcome payload
  socket.send(JSON.stringify({
    type: 'welcome',
    mode: appState.mode,
    count: appState.clients.size,
    totalColorChanges: appState.totalColorChanges,
    roomColor: appState.roomColorHex,
    photos: appState.photos,
    textResponses: appState.textResponses.slice(-20),
    questions: appState.questions.slice(-20),
    students: [...appState.clients.entries()]
      .filter(([, c]) => c.name && !c.isHost)
      .map(([, c]) => ({ name: c.name, hex: c.hex, colorsSent: c.colorsSent })),
  }));

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // Ignore malformed messages
    }

    handleMessage(socket, msg);
  });

  socket.on('close', () => {
    const client = appState.clients.get(socket);
    appState.clients.delete(socket);

    // Notify remaining clients of new count
    broadcast({
      type: 'join', // reuse join for count update
      name: client?.name,
      count: studentCount(),
    });
  });

  socket.on('error', (err) => {
    console.error('[ws] Socket error:', err.message);
  });
});

// ─── Message handler ───────────────────────────────────────────────────────

function handleMessage(socket, msg) {
  const client = appState.clients.get(socket);
  if (!client) return;

  switch (msg.type) {

    case 'join': {
      const name = sanitize(msg.name);
      const hex  = sanitizeHex(msg.hex);
      if (!name || !hex) return;

      client.name = name;
      client.hex  = hex;

      // Confirm to sender
      socket.send(JSON.stringify({ type: 'joined', count: studentCount() }));

      // Broadcast join to everyone
      broadcast({ type: 'join', name, hex, count: studentCount() });
      break;
    }

    case 'color': {
      if (!client.name) return;
      const hex = sanitizeHex(msg.hex);
      if (!hex) return;

      client.hex = hex;
      client.colorsSent++;
      appState.totalColorChanges++;
      appState.roomColorHex = hex;

      // Send to WiZ bulbs
      sendToWiz(hex);

      // Broadcast to all clients
      broadcast({ type: 'color', name: client.name, hex });
      break;
    }

    case 'reaction': {
      if (!client.name) return;
      const emoji = sanitizeEmoji(msg.emoji);
      if (!emoji) return;

      broadcast({ type: 'reaction', name: client.name, emoji });
      break;
    }

    case 'text_response': {
      if (!client.name) return;
      const text = sanitize(msg.text, 200);
      if (!text) return;

      const entry = { name: client.name, text, hex: client.hex };
      appState.textResponses.push(entry);

      broadcast({ type: 'text_response', ...entry });
      break;
    }

    case 'question': {
      if (!client.name) return;
      const text = sanitize(msg.text, 300);
      if (!text) return;

      const entry = { name: client.name, text, hex: client.hex };
      appState.questions.push(entry);

      broadcast({ type: 'question', ...entry });
      break;
    }

    // ── Host-only messages ──

    case 'host_join': {
      if (msg.key !== HOST_KEY) return;
      client.isHost = true;
      client.name   = '__host__';
      break;
    }

    case 'host_color': {
      if (msg.key !== HOST_KEY || !client.isHost) return;
      const hex = sanitizeHex(msg.hex);
      if (!hex) return;

      appState.roomColorHex = hex;
      sendToWiz(hex);
      broadcast({ type: 'color', name: 'Ashika', hex });
      break;
    }

    case 'mode': {
      if (msg.key !== HOST_KEY || !client.isHost) return;
      const mode = sanitizeMode(msg.mode);
      if (!mode) return;

      appState.mode = mode;
      broadcast({ type: 'mode', mode });

      if (mode === 'demo') {
        broadcast({ type: 'demo_start' });
      }
      break;
    }

    default:
      break;
  }
}

// ─── Broadcast helpers ─────────────────────────────────────────────────────

function broadcast(msg, excludeSocket = null) {
  const str = JSON.stringify(msg);
  appState.clients.forEach((_, socket) => {
    if (socket !== excludeSocket && socket.readyState === WebSocket.OPEN) {
      socket.send(str);
    }
  });
}

function studentCount() {
  let count = 0;
  appState.clients.forEach(c => { if (c.name && !c.isHost) count++; });
  return count;
}

// ─── Sanitizers ────────────────────────────────────────────────────────────

function sanitize(str, maxLen = 100) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen).replace(/[<>]/g, '');
}

function sanitizeHex(str) {
  if (typeof str !== 'string') return null;
  const match = str.trim().match(/^#[0-9A-Fa-f]{6}$/);
  return match ? str.trim().toUpperCase() : null;
}

function sanitizeEmoji(str) {
  const ALLOWED = ['👀', '💡', '🔥', '😮'];
  return ALLOWED.includes(str) ? str : null;
}

function sanitizeMode(str) {
  const ALLOWED = ['lobby', 'color', 'ambient', 'photos', 'text', 'demo', 'qa', 'sendoff'];
  return ALLOWED.includes(str) ? str : null;
}

// ─── Start ─────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`\n  Light Room server running!\n`);
  console.log(`  Student app: http://localhost:${PORT}/`);
  console.log(`  Host dash:   http://localhost:${PORT}/host?key=${HOST_KEY}`);
  console.log(`  WiZ bulbs:   ${WIZ_IPS.length ? WIZ_IPS.join(', ') : '(none configured — set WIZ_IPS env var)'}`);
  console.log(`\n  Mode: ${appState.mode}`);
  console.log(`  Press Ctrl+C to stop.\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n  Shutting down...');
  wss.close();
  httpServer.close(() => process.exit(0));
});
