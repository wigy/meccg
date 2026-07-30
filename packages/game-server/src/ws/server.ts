/**
 * @module server
 *
 * WebSocket server entry point for a single MECCG game.
 *
 * Takes two player names as arguments. Only those names can be players;
 * everyone else is a spectator. The server exits on SIGTERM/SIGINT, or on
 * its own once no human player has been connected for a grace period —
 * the lobby watches the child exit to clear busy status and the watchable
 * game row, so a session must not outlive the humans playing it.
 *
 * Usage: npx tsx src/ws/server.ts <player1> <player2> [--dev]
 */

import { WebSocketServer } from 'ws';
import { GameSession } from './game-session.js';

const args = process.argv.filter(a => !a.startsWith('--'));
const PLAYER1_NAME = args[2];
const PLAYER2_NAME = args[3];

if (!PLAYER1_NAME || !PLAYER2_NAME) {
  console.error('Usage: server <player1> <player2> [--dev]');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const DEV = process.argv.includes('--dev') || process.env.DEV === '1';

const wss = new WebSocketServer({ port: PORT });
const session = new GameSession({
  dev: DEV,
  playerNames: [PLAYER1_NAME, PLAYER2_NAME],
  onIdle: () => {
    console.log('No human players connected — shutting down.');
    shutdown();
  },
});

console.log(`MECCG server listening on port ${PORT}${DEV ? ' (dev mode)' : ''}`);

wss.on('connection', (ws) => {
  session.addConnection(ws);
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  session.gracefulShutdown();

  wss.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGUSR2', shutdown);
