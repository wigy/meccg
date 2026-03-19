/**
 * @module server
 *
 * WebSocket server entry point for a single MECCG game.
 *
 * Takes two player names as arguments. Only those names can be players;
 * everyone else is a spectator. Once the game ends, the server exits.
 * In future, a master server will spawn one of these per game.
 *
 * Usage: npx tsx src/ws/server.ts <player1> <player2> [--debug]
 */

import { WebSocketServer } from 'ws';
import { GameSession } from './game-session.js';

const args = process.argv.filter(a => !a.startsWith('--'));
const PLAYER1_NAME = args[2];
const PLAYER2_NAME = args[3];

if (!PLAYER1_NAME || !PLAYER2_NAME) {
  console.error('Usage: server <player1> <player2> [--debug]');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const DEBUG = process.argv.includes('--debug') || process.env.DEBUG === '1';

const wss = new WebSocketServer({ port: PORT });
const session = new GameSession({
  debug: DEBUG,
  playerNames: [PLAYER1_NAME, PLAYER2_NAME],
});

console.log(`MECCG server listening on port ${PORT}`);
console.log(`Players: ${PLAYER1_NAME} vs ${PLAYER2_NAME}`);
console.log('Waiting for players to connect...');

wss.on('connection', (ws) => {
  console.log('Client connected');
  session.addConnection(ws);
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\nServer shutting down...');
  session.gracefulShutdown();

  wss.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGUSR2', shutdown);
