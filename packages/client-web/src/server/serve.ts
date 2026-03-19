/**
 * @module serve
 *
 * HTTP server for static files + WebSocket proxy to the game server.
 * The browser connects here for both HTTP (HTML/JS/CSS) and WebSocket
 * (game protocol). WS connections are transparently proxied to the
 * game server — no message transformation.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { colorDebug } from '@meccg/shared';

const DEBUG = process.argv.includes('--debug') || process.env.DEBUG === '1';
const PORT = parseInt(process.env.PORT ?? '8080', 10);
const GAME_SERVER = process.env.GAME_SERVER ?? 'ws://localhost:3000';
const PUBLIC_DIR = path.join(__dirname, '../../public');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

/** Serve static files from the public/ directory. */
const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url ?? '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

/** WebSocket proxy: browser ↔ game server. */
const wss = new WebSocketServer({ server });

wss.on('connection', (browserWs) => {
  console.log('Browser connected, proxying to game server...');

  const gameWs = new WebSocket(GAME_SERVER);
  const pendingMessages: Buffer[] = [];

  gameWs.on('open', () => {
    console.log('Connected to game server');
    for (const msg of pendingMessages) {
      gameWs.send(msg);
    }
    pendingMessages.length = 0;
  });

  // Proxy: browser → game server (buffer until upstream is open)
  browserWs.on('message', (data) => {
    if (DEBUG) {
      console.log(colorDebug(`browser >> ${data.toString()}`));
    }
    if (gameWs.readyState === WebSocket.OPEN) {
      gameWs.send(data);
    } else {
      pendingMessages.push(Buffer.from(data as ArrayBuffer));
    }
  });

  // Proxy: game server → browser
  gameWs.on('message', (data) => {
    if (DEBUG) {
      console.log(colorDebug(`server >> ${data.toString()}`));
    }
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data);
    }
  });

  // Close propagation
  browserWs.on('close', () => {
    console.log('Browser disconnected');
    gameWs.close();
  });

  gameWs.on('close', () => {
    console.log('Game server disconnected');
    browserWs.close();
  });

  gameWs.on('error', (err) => {
    console.error('Game server error:', err.message);
    browserWs.close();
  });
});

server.listen(PORT, () => {
  console.log(`MECCG web client serving on http://localhost:${PORT}`);
  console.log(`Proxying WebSocket to ${GAME_SERVER}`);
});
