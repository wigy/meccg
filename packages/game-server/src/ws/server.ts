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
 * Usage: npx tsx src/ws/server.ts <player1> <player2> [--dev] [--tutorial]
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
const TUTORIAL = process.argv.includes('--tutorial');

const wss = new WebSocketServer({ port: PORT });
const session = new GameSession({
  dev: DEV,
  tutorial: TUTORIAL,
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

/**
 * WebSocket keepalive: ping every client on a short interval. Browsers
 * answer protocol pings automatically, so even an AFK player's socket
 * carries periodic traffic — without it, an idle-timeout proxy on the
 * path (e.g. nginx `proxy_read_timeout`) cuts the connection and the
 * client falls into the rejoin flow although this server is alive.
 */
const KEEPALIVE_INTERVAL_MS = 30_000;
const keepaliveTimer = setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.ping();
  }
}, KEEPALIVE_INTERVAL_MS);

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  clearInterval(keepaliveTimer);
  session.gracefulShutdown();

  wss.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGUSR2', shutdown);
