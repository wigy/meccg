/**
 * @module server
 *
 * WebSocket server entry point for the MECCG game server.
 *
 * Starts a `ws` WebSocket server on the configured port (default 3000,
 * overridable via the `PORT` environment variable) and delegates all
 * incoming connections to a single {@link GameSession} instance.
 *
 * On SIGTERM, SIGINT, or SIGUSR2 (from tsx watch), the server performs
 * a graceful shutdown: saves the game, sends a "restart" message to all
 * connected clients, closes the WebSocket server, then exits.
 */

import { WebSocketServer } from 'ws';
import { GameSession } from './game-session.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const DEBUG = process.argv.includes('--debug');

const wss = new WebSocketServer({ port: PORT });
const session = new GameSession({ debug: DEBUG });

console.log(`MECCG server listening on port ${PORT}`);
console.log('Waiting for two players to connect...');

wss.on('connection', (ws) => {
  console.log('Client connected');
  session.addConnection(ws);
});

let shuttingDown = false;

/** Graceful shutdown: save game, notify clients, close server, exit. */
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\nServer shutting down...');
  session.gracefulShutdown();

  // Close the WebSocket server to release the port
  wss.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force exit after 3 seconds if close hangs
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGUSR2', shutdown);
