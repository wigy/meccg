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
import { getDisplayName, getCredits } from '../players/store.js';

/** Connection info for an active game that a player can rejoin. */
interface ActiveGameInfo {
  readonly port: number;
  readonly token: string;
  readonly opponent: string;
  readonly opponentDisplayName: string;
}

/** A connected player in the lobby. */
interface OnlinePlayer {
  readonly name: string;
  ws: WebSocket;
  /** Set of player names who have sent us a challenge. */
  readonly pendingFrom: Set<string>;
  /** Whether this player is currently in a game. */
  inGame: boolean;
  /** Active game connection info, kept for rejoin after server restart. */
  activeGame: ActiveGameInfo | null;
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
    credits: getCredits(name),
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
  // If already connected (e.g. page refresh), update the WS but preserve game state
  const existing = onlinePlayers.get(name);
  if (existing) {
    existing.ws.close();
    existing.ws = ws;
  }

  const player: OnlinePlayer = existing ?? { name, ws, pendingFrom: new Set(), inGame: false, activeGame: null };
  if (!existing) onlinePlayers.set(name, player);
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

    case 'play-smart-ai': {
      if (from.inGame) {
        send(from.ws, { type: 'error', message: 'You are already in a game' });
        return;
      }
      void startAiGame(from, msg.deckId);
      break;
    }

    case 'play-pseudo-ai': {
      if (from.inGame) {
        send(from.ws, { type: 'error', message: 'You are already in a game' });
        return;
      }
      void startPseudoAiGame(from, msg.deckId);
      break;
    }

    case 'rejoin-game': {
      const opponentName = msg.opponent;
      const isAi = opponentName.startsWith('AI-');

      // If the opponent already relaunched a game that includes us, just
      // send back the stored connection info without launching another server.
      if (from.activeGame && from.activeGame.opponent === opponentName) {
        lobbyLog.log('rejoin-existing', { name: fromName, opponent: opponentName });
        send(from.ws, { type: 'game-starting', ...from.activeGame });
        break;
      }

      // Clear stale inGame state from the dead game
      from.inGame = false;
      from.activeGame = null;

      if (opponentName === 'AI-Pseudo') {
        void startPseudoAiGame(from);
      } else if (isAi) {
        void startAiGame(from);
      } else {
        const opponent = onlinePlayers.get(opponentName);
        if (!opponent) {
          send(from.ws, { type: 'error', message: `${opponentName} is no longer online` });
          return;
        }
        opponent.inGame = false;
        opponent.activeGame = null;
        void startGame(from, opponent);
      }
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

    const p1Game: ActiveGameInfo = {
      port: result.port,
      token: result.tokens[0],
      opponent: player2.name,
      opponentDisplayName: getDisplayName(player2.name),
    };
    const p2Game: ActiveGameInfo = {
      port: result.port,
      token: result.tokens[1],
      opponent: player1.name,
      opponentDisplayName: getDisplayName(player1.name),
    };
    player1.activeGame = p1Game;
    player2.activeGame = p2Game;

    send(player1.ws, { type: 'game-starting', ...p1Game });
    send(player2.ws, { type: 'game-starting', ...p2Game });

    // When the game ends, mark players as available again
    result.onEnd(() => {
      player1.inGame = false;
      player2.inGame = false;
      player1.activeGame = null;
      player2.activeGame = null;
      player1.pendingFrom.clear();
      player2.pendingFrom.clear();
      broadcastPlayerList();
      lobbyLog.log('game-end', { player1: player1.name, player2: player2.name });
    });
  } catch (err) {
    lobbyLog.log('error', { context: 'game-start', error: String(err) });
    player1.inGame = false;
    player2.inGame = false;
    player1.activeGame = null;
    player2.activeGame = null;
    send(player1.ws, { type: 'error', message: 'Failed to start game server' });
    send(player2.ws, { type: 'error', message: 'Failed to start game server' });
  }
}

/** Launch a game against the Smart-AI (heuristic strategy). */
async function startAiGame(player: OnlinePlayer, deckId?: string): Promise<void> {
  player.inGame = true;
  const aiName = 'AI-Smart';

  try {
    const result = await launchGame(player.name, aiName, { ai: true, aiDeckId: deckId });
    lobbyLog.log('game-start', { player1: player.name, player2: aiName, ai: true, port: result.port });

    player.activeGame = {
      port: result.port,
      token: result.tokens[0],
      opponent: aiName,
      opponentDisplayName: aiName,
    };
    send(player.ws, { type: 'game-starting', ...player.activeGame });

    result.onEnd(() => {
      player.inGame = false;
      player.activeGame = null;
      player.pendingFrom.clear();
      broadcastPlayerList();
      lobbyLog.log('game-end', { player1: player.name, player2: aiName, ai: true });
    });
  } catch (err) {
    lobbyLog.log('error', { context: 'ai-game-start', error: String(err) });
    player.inGame = false;
    player.activeGame = null;
    send(player.ws, { type: 'error', message: 'Failed to start game server' });
  }
}

/** Launch a pseudo-AI game where the human controls both sides via two WS connections. */
async function startPseudoAiGame(player: OnlinePlayer, deckId?: string): Promise<void> {
  player.inGame = true;
  const aiName = 'AI-Pseudo';

  try {
    // No AI client process — the web client connects twice (as human + AI)
    const result = await launchGame(player.name, aiName, { aiDeckId: deckId });
    lobbyLog.log('game-start', { player1: player.name, player2: aiName, pseudoAi: true, port: result.port });

    player.activeGame = {
      port: result.port,
      token: result.tokens[0],
      opponent: aiName,
      opponentDisplayName: aiName,
    };
    send(player.ws, {
      type: 'game-starting',
      ...player.activeGame,
      pseudoAi: true,
      aiToken: result.tokens[1],
    });

    result.onEnd(() => {
      player.inGame = false;
      player.activeGame = null;
      player.pendingFrom.clear();
      broadcastPlayerList();
      lobbyLog.log('game-end', { player1: player.name, player2: aiName, pseudoAi: true });
    });
  } catch (err) {
    lobbyLog.log('error', { context: 'pseudo-ai-game-start', error: String(err) });
    player.inGame = false;
    player.activeGame = null;
    send(player.ws, { type: 'error', message: 'Failed to start game server' });
  }
}
