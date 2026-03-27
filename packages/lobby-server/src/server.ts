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
import { WebSocketServer } from 'ws';
import { LOBBY_PORT, DEV } from './config.js';
import { handleRequest } from './http/routes.js';
import { playerConnected } from './lobby/lobby.js';
import { getPayloadFromCookie } from './auth/session.js';
import { shutdownAllGames } from './games/launcher.js';
import { lobbyLog } from './lobby-log.js';

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

  wss.handleUpgrade(req, socket, head, (ws) => {
    playerConnected(payload.sub, ws);
  });
});

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
