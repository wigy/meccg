/**
 * @module client-common
 *
 * Shared plumbing for the text clients (interactive console, headless AI,
 * pseudo-AI relay): deck catalog loading, CLI argument parsing for
 * lobby-spawned clients, the join/rejoin handshake, and the
 * server-message and reconnect handling that differs between the headless
 * clients only by log prefix.
 */

import type { WebSocket } from 'ws';
import type { ClientMessage, JoinMessage, ServerMessage } from '@meccg/shared';
import { Alignment } from '@meccg/shared';
import { loadDeck, listDecks } from '@meccg/sim';

// ---- Deck catalog (shared with the sim harness in @meccg/sim) ----

/** Load a catalog deck into a join message for the given player. */
export function loadDeckJoin(deckId: string, playerName: string): JoinMessage {
  const deck = loadDeck(deckId);
  return {
    type: 'join',
    name: playerName,
    alignment: deck.alignment,
    draftPool: deck.draftPool,
    playDeck: deck.playDeck,
    siteDeck: deck.siteDeck,
    sideboard: deck.sideboard,
  };
}

/**
 * Minimal join for reattaching to a game the server restored from autosave —
 * the server already has the decks, so only the name matters.
 */
export function rejoinMessage(playerName: string): JoinMessage {
  return { type: 'join', name: playerName, alignment: Alignment.Wizard, draftPool: [], playDeck: [], siteDeck: [], sideboard: [] };
}

/** List `{id, name}` of every deck in the catalog. */
export function listCatalogDecks(): { id: string; name: string }[] {
  return listDecks();
}

// ---- Spawned-client scaffolding (headless AI and pseudo-AI) ----

/** Parsed CLI args for lobby-spawned clients: `<port> <name> <token> [--deck id]`. */
export interface SpawnedClientArgs {
  port: number;
  playerName: string;
  token: string;
  deckId?: string;
}

/**
 * Parse a spawned client's argv. Prints usage and exits the process when a
 * required argument is missing.
 */
export function parseSpawnedClientArgs(usageName: string): SpawnedClientArgs {
  const args = process.argv.filter(a => !a.startsWith('--'));
  const port = parseInt(args[2], 10);
  const playerName = args[3];
  const token = args[4];
  const deckIdx = process.argv.indexOf('--deck');
  const deckId = deckIdx >= 0 ? process.argv[deckIdx + 1] : undefined;
  if (!port || !playerName || !token) {
    console.error(`Usage: ${usageName} <port> <playerName> <token> [--deck <deckId>]`);
    process.exit(1);
  }
  return { port, playerName, token, deckId };
}

/**
 * Build the serialized join a spawned client sends on socket open: a full
 * deck join when a deck was given, or a minimal rejoin when the server is
 * restoring the game from autosave. The auth token is attached either way.
 */
export function spawnedJoinPayload(clientArgs: SpawnedClientArgs, logPrefix: string): string {
  let joinMsg: JoinMessage;
  if (clientArgs.deckId) {
    console.log(`${logPrefix} connected, sending join with deck "${clientArgs.deckId}"...`);
    joinMsg = loadDeckJoin(clientArgs.deckId, clientArgs.playerName);
  } else {
    console.log(`${logPrefix} connected, sending minimal join (rejoin)...`);
    joinMsg = rejoinMessage(clientArgs.playerName);
  }
  const msg: ClientMessage = { ...joinMsg, token: clientArgs.token } as ClientMessage;
  return JSON.stringify(msg);
}

/** Parse a raw WebSocket message buffer into a {@link ServerMessage}. */
export function parseServerMessage(raw: Buffer): ServerMessage {
  return JSON.parse(raw.toString()) as ServerMessage;
}

/**
 * Handle the server-message cases shared by the headless clients
 * (assigned / error / waiting / restart / disconnected), which differ only
 * by log prefix. Returns true when the message was one of those cases.
 */
export function logCommonServerMessage(logPrefix: string, msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'assigned':
      console.log(`${logPrefix} assigned player ID: ${msg.playerId}`);
      return true;
    case 'error':
      console.log(`${logPrefix} received error: ${msg.message}`);
      return true;
    case 'waiting':
      console.log(`${logPrefix} waiting for opponent...`);
      return true;
    case 'restart':
      console.log(`${logPrefix}: server restarting, will reconnect...`);
      return true;
    case 'disconnected':
      console.log(`${logPrefix}: opponent disconnected`);
      return true;
    default:
      return false;
  }
}

/**
 * Install the shared close/error handlers for a spawned client's socket:
 * reconnect 2s after a close, and retry 1s after a connection error.
 * `onClose` runs before the reconnect is scheduled (e.g. to clear a shared
 * socket reference).
 */
export function installReconnect(
  ws: WebSocket,
  logPrefix: string,
  reconnect: () => void,
  onClose?: () => void,
): void {
  ws.on('close', () => {
    onClose?.();
    console.log(`${logPrefix} disconnected, reconnecting in 2s...`);
    setTimeout(reconnect, 2000);
  });

  ws.on('error', (err) => {
    console.error(`${logPrefix} connection error:`, err.message);
    setTimeout(() => {
      console.log(`${logPrefix} retrying connection...`);
      reconnect();
    }, 1000);
  });
}
