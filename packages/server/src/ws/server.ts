/**
 * @module server
 *
 * WebSocket server entry point for the MECCG game server.
 *
 * Starts a bare `ws` WebSocket server on the configured port (default 3000,
 * overridable via the `PORT` environment variable) and delegates all
 * incoming connections to a single {@link GameSession} instance.
 *
 * The current design supports exactly one game at a time — the first two
 * clients to connect and send "join" messages become the two players. This
 * is intentionally simple; lobby/matchmaking can be layered on later.
 */

import { WebSocketServer } from 'ws';
import { GameSession } from './game-session.js';

/** Port the WebSocket server binds to. Configurable via the `PORT` env var. */
const PORT = parseInt(process.env.PORT ?? '3000', 10);

const wss = new WebSocketServer({ port: PORT });
const session = new GameSession();

console.log(`MECCG server listening on port ${PORT}`);
console.log('Waiting for two players to connect...');

wss.on('connection', (ws) => {
  console.log('Client connected');
  session.addConnection(ws);
});
