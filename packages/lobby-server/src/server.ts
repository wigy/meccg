/**
 * @module server
 *
 * Lobby server entry point. Serves static files from the web-client,
 * handles auth API routes, manages lobby WebSocket connections, and
 * spawns game-server child processes on demand.
 *
 * Usage: npx tsx src/server.ts [--dev]
 */

import * as http from 'http';
import * as net from 'net';
import type { Duplex } from 'stream';
import { WebSocketServer } from 'ws';
import { LOBBY_PORT, DEV } from './config.js';
import { handleRequest } from './http/routes.js';
import { playerConnected } from './lobby/lobby.js';
import { getPayloadFromCookie } from './auth/session.js';
import { isActiveGamePort, shutdownAllGames } from './games/launcher.js';
import { lobbyLog } from './lobby-log.js';
import { ensureSystemPlayers } from './players/store.js';

ensureSystemPlayers();

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    lobbyLog.log('error', { context: 'request', error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('Internal server error');
    }
  });
});

/** Lobby WebSocket server — authenticates via session cookie on upgrade. */
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  // Authenticate using the session cookie
  const payload = getPayloadFromCookie(req.headers.cookie);
  if (!payload) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Game-server proxy: /game/<port> is forwarded to 127.0.0.1:<port>
  // so deployments behind a single-port TLS terminator don't need the
  // 4000-5000 range exposed. The game server still authenticates the
  // client via the JWT in the join message — this proxy is a dumb pipe.
  const gameMatch = req.url ? /^\/game\/(\d+)(?:$|[/?])/.exec(req.url) : null;
  if (gameMatch) {
    const gamePort = Number(gameMatch[1]);
    if (!isActiveGamePort(gamePort)) {
      lobbyLog.log('proxy-reject', { port: gamePort, reason: 'not-active' });
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    proxyGameUpgrade(req, socket, head, gamePort);
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    playerConnected(payload.sub, ws);
  });
});

/**
 * Forward a WebSocket upgrade to a game-server child process by opening a
 * raw TCP connection to 127.0.0.1:<port>, replaying the HTTP upgrade request
 * with the path rewritten to "/", and piping both sockets together. The
 * game server accepts all upgrade paths, so "/" works regardless of what
 * the client asked for.
 */
function proxyGameUpgrade(
  req: http.IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  gamePort: number,
): void {
  const upstream = net.connect(gamePort, '127.0.0.1');

  const destroyBoth = (): void => {
    if (!upstream.destroyed) upstream.destroy();
    if (!clientSocket.destroyed) clientSocket.destroy();
  };

  upstream.on('error', (err) => {
    lobbyLog.log('proxy-upstream-error', { port: gamePort, error: String(err) });
    if (!clientSocket.destroyed) {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    }
    destroyBoth();
  });
  clientSocket.on('error', destroyBoth);

  upstream.on('connect', () => {
    const lines: string[] = [`${req.method ?? 'GET'} / HTTP/1.1`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) lines.push(`${key}: ${v}`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    }
    lines.push('', '');
    upstream.write(lines.join('\r\n'));
    if (head && head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
}

server.listen(LOBBY_PORT, () => {
  lobbyLog.log('boot', { port: LOBBY_PORT, dev: DEV });
});

// Graceful shutdown
function shutdown(): void {
  lobbyLog.log('shutdown');
  shutdownAllGames();
  wss.close();
  server.close(() => {
    lobbyLog.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
