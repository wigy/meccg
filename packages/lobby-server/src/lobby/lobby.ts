/**
 * @module lobby/lobby
 *
 * Manages online player presence and the challenge/accept flow.
 * Each authenticated player has a WebSocket connection to the lobby.
 * The lobby tracks who is online, routes challenges, and triggers
 * game launches when both players agree.
 */

import type WebSocket from 'ws';
import type { LobbyClientMessage, LobbyServerMessage } from './protocol.js';
import { launchGame } from '../games/launcher.js';
import { lobbyLog } from '../lobby-log.js';
import { getDisplayName } from '../players/store.js';

/** A connected player in the lobby. */
interface OnlinePlayer {
  readonly name: string;
  readonly ws: WebSocket;
  /** Set of player names who have sent us a challenge. */
  readonly pendingFrom: Set<string>;
  /** Whether this player is currently in a game. */
  inGame: boolean;
}

/** The lobby state: tracks online players and pending challenges. */
const onlinePlayers = new Map<string, OnlinePlayer>();

/** Send a typed message to a WebSocket. */
function send(ws: WebSocket, msg: LobbyServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** Broadcast the current online player list to everyone. */
function broadcastPlayerList(): void {
  const players = Array.from(onlinePlayers.keys()).map(name => ({
    name,
    displayName: getDisplayName(name),
  }));
  const msg: LobbyServerMessage = { type: 'online-players', players };
  for (const p of onlinePlayers.values()) {
    send(p.ws, msg);
  }
}

/** Send a typed message to a specific player if they are online. Silently drops if offline. */
export function notifyPlayer(name: string, msg: LobbyServerMessage): void {
  const player = onlinePlayers.get(name);
  if (player) {
    send(player.ws, msg);
  }
}

/** Send a system notification to all online players. */
export function broadcastNotification(message: string): void {
  const msg: LobbyServerMessage = { type: 'system-notification', message };
  for (const p of onlinePlayers.values()) {
    send(p.ws, msg);
  }
}

/** Register a new player connection in the lobby. */
export function playerConnected(name: string, ws: WebSocket): void {
  // If already connected (e.g. page refresh), close the old connection
  const existing = onlinePlayers.get(name);
  if (existing) {
    existing.ws.close();
  }

  const player: OnlinePlayer = { name, ws, pendingFrom: new Set(), inGame: false };
  onlinePlayers.set(name, player);
  lobbyLog.log('connect', { name, online: onlinePlayers.size });
  broadcastPlayerList();

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString()) as LobbyClientMessage;
      handleMessage(name, msg);
    } catch {
      send(ws, { type: 'error', message: 'Invalid message format' });
    }
  });

  ws.on('close', () => {
    // Only remove if this is still the current connection for this player
    const current = onlinePlayers.get(name);
    if (current && current.ws === ws) {
      onlinePlayers.delete(name);
      lobbyLog.log('disconnect', { name, online: onlinePlayers.size });
      broadcastPlayerList();
    }
  });
}

/** Handle a message from a connected player. */
function handleMessage(fromName: string, msg: LobbyClientMessage): void {
  const from = onlinePlayers.get(fromName);
  if (!from) return;

  switch (msg.type) {
    case 'challenge': {
      const target = onlinePlayers.get(msg.opponentName);
      if (!target) {
        send(from.ws, { type: 'error', message: `${msg.opponentName} is not online` });
        return;
      }
      if (target.inGame) {
        send(from.ws, { type: 'error', message: `${msg.opponentName} is already in a game` });
        return;
      }
      if (msg.opponentName === fromName) {
        send(from.ws, { type: 'error', message: 'You cannot challenge yourself' });
        return;
      }
      target.pendingFrom.add(fromName);
      send(target.ws, { type: 'challenge-received', from: fromName, fromDisplayName: getDisplayName(fromName) });
      break;
    }

    case 'accept-challenge': {
      if (!from.pendingFrom.has(msg.from)) {
        send(from.ws, { type: 'error', message: 'No pending challenge from that player' });
        return;
      }
      from.pendingFrom.delete(msg.from);
      const challenger = onlinePlayers.get(msg.from);
      if (!challenger) {
        send(from.ws, { type: 'error', message: `${msg.from} is no longer online` });
        return;
      }
      void startGame(challenger, from);
      break;
    }

    case 'decline-challenge': {
      from.pendingFrom.delete(msg.from);
      const challenger = onlinePlayers.get(msg.from);
      if (challenger) {
        send(challenger.ws, { type: 'challenge-declined', by: fromName, byDisplayName: getDisplayName(fromName) });
      }
      break;
    }

    case 'play-ai': {
      if (from.inGame) {
        send(from.ws, { type: 'error', message: 'You are already in a game' });
        return;
      }
      void startAiGame(from);
      break;
    }
  }
}

/** Launch a game between two players. */
async function startGame(player1: OnlinePlayer, player2: OnlinePlayer): Promise<void> {
  player1.inGame = true;
  player2.inGame = true;

  try {
    const result = await launchGame(player1.name, player2.name);
    lobbyLog.log('game-start', { player1: player1.name, player2: player2.name, port: result.port });

    send(player1.ws, {
      type: 'game-starting',
      port: result.port,
      token: result.tokens[0],
      opponent: player2.name,
      opponentDisplayName: getDisplayName(player2.name),
    });
    send(player2.ws, {
      type: 'game-starting',
      port: result.port,
      token: result.tokens[1],
      opponent: player1.name,
      opponentDisplayName: getDisplayName(player1.name),
    });

    // When the game ends, mark players as available again
    result.onEnd(() => {
      player1.inGame = false;
      player2.inGame = false;
      player1.pendingFrom.clear();
      player2.pendingFrom.clear();
      broadcastPlayerList();
      lobbyLog.log('game-end', { player1: player1.name, player2: player2.name });
    });
  } catch (err) {
    lobbyLog.log('error', { context: 'game-start', error: String(err) });
    player1.inGame = false;
    player2.inGame = false;
    send(player1.ws, { type: 'error', message: 'Failed to start game server' });
    send(player2.ws, { type: 'error', message: 'Failed to start game server' });
  }
}

/** Launch a game against the AI. */
async function startAiGame(player: OnlinePlayer): Promise<void> {
  player.inGame = true;
  const aiName = 'AI-Random';

  try {
    const result = await launchGame(player.name, aiName, { ai: true });
    lobbyLog.log('game-start', { player1: player.name, player2: aiName, ai: true, port: result.port });

    send(player.ws, {
      type: 'game-starting',
      port: result.port,
      token: result.tokens[0],
      opponent: aiName,
      opponentDisplayName: aiName,
    });

    result.onEnd(() => {
      player.inGame = false;
      player.pendingFrom.clear();
      broadcastPlayerList();
      lobbyLog.log('game-end', { player1: player.name, player2: aiName, ai: true });
    });
  } catch (err) {
    lobbyLog.log('error', { context: 'ai-game-start', error: String(err) });
    player.inGame = false;
    send(player.ws, { type: 'error', message: 'Failed to start game server' });
  }
}
