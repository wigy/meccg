/**
 * @module game-session
 *
 * Manages the lifecycle of a single MECCG game over WebSocket connections.
 *
 * Handles player registration, game creation, action routing, and
 * save/restore on disconnect. When a player disconnects mid-game, the
 * state is saved to a JSON file keyed by the sorted pair of player names.
 * When both players reconnect with the same names, the game resumes
 * automatically.
 */

import * as fs from 'fs';
import * as path from 'path';
import type WebSocket from 'ws';
import type {
  GameState,
  PlayerId,
  CardDefinition,
  ClientMessage,
  ServerMessage,
  JoinMessage,
  GameAction,
} from '@meccg/shared';
import { formatGameState, loadCardPool, colorDebug } from '@meccg/shared';
import { createGame } from '../engine/init.js';
import type { PlayerConfig, GameConfig } from '../engine/init.js';
import { reduce } from '../engine/reducer.js';
import { projectPlayerView, projectSpectatorView } from './projection.js';

/** Directory where game save files are stored. */
const SAVE_DIR = process.env.SAVE_DIR ?? path.join(process.cwd(), 'saves');

/** A client that has sent a "join" message but is waiting for an opponent. */
interface PendingPlayer {
  ws: WebSocket;
  join: JoinMessage;
}

/** Persisted game save: state + mapping from player names to player IDs. */
interface GameSave {
  state: GameState;
  nameToPlayerId: Record<string, string>;
}

/**
 * Orchestrates a single two-player MECCG game with save/restore support.
 *
 * Flow:
 * 1. Two clients connect and send "join" messages.
 * 2. If a save file exists for these two player names, the game resumes.
 * 3. Otherwise a new game is created starting in the character draft phase.
 * 4. On disconnect: state is saved to disk, opponent is notified and disconnected.
 * 5. When both players reconnect, the save is loaded and play continues.
 */
export class GameSession {
  private state: GameState | null = null;
  private players: Map<string, { ws: WebSocket; playerId: PlayerId; name: string }> = new Map();
  /** Connected spectators — receive state updates but cannot submit actions. */
  private spectators: Set<WebSocket> = new Set();
  private pending: PendingPlayer[] = [];
  private cardPool: Readonly<Record<string, CardDefinition>>;
  /** Maps player name → PlayerId for the current game. */
  private nameToPlayerId: Record<string, string> = {};
  private playerCounter = 0;
  private debug: boolean;

  constructor(options?: { debug?: boolean }) {
    this.debug = options?.debug ?? false;
    this.cardPool = loadCardPool();
    fs.mkdirSync(SAVE_DIR, { recursive: true });
  }

  /**
   * Graceful shutdown: saves the game if in progress, sends "restart"
   * to all connected clients so they can auto-reconnect, and closes
   * all WebSocket connections.
   */
  gracefulShutdown(): void {
    if (this.state) {
      this.saveGame();
    }

    const restartMsg: ServerMessage = { type: 'restart', message: 'Server restarting. Reconnecting...' };

    for (const p of this.pending) {
      this.send(p.ws, restartMsg);
      p.ws.close();
    }
    this.pending = [];

    for (const [, { ws }] of this.players.entries()) {
      this.send(ws, restartMsg);
      ws.close();
    }
    this.players.clear();

    for (const ws of this.spectators) {
      this.send(ws, restartMsg);
      ws.close();
    }
    this.spectators.clear();

    this.state = null;
  }

  addConnection(ws: WebSocket): void {
    ws.on('message', (data) => {
      try {
        if (this.debug) {
          console.log(colorDebug(`<< ${data.toString()}`));
        }
        const msg: ClientMessage = JSON.parse(data.toString());
        this.handleMessage(ws, msg);
      } catch {
        this.send(ws, { type: 'error', message: 'Invalid message format' });
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(ws);
    });
  }

  private handleMessage(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case 'join':
        this.handleJoin(ws, msg);
        break;
      case 'action':
        this.handleAction(ws, msg.action);
        break;
    }
  }

  private handleJoin(ws: WebSocket, msg: JoinMessage): void {
    // Reject if this name is already connected as a player
    for (const [, player] of this.players.entries()) {
      if (player.name === msg.name) {
        this.send(ws, { type: 'error', message: `Player "${msg.name}" is already connected` });
        return;
      }
    }

    // If game is already in progress, join as spectator
    if (this.state) {
      this.addSpectator(ws, msg.name);
      return;
    }

    this.pending.push({ ws, join: msg });
    console.log(`${msg.name} joined`);

    if (this.pending.length < 2) {
      this.send(ws, { type: 'waiting' });
      return;
    }

    // Two players ready — try to restore or start new game
    const [p1, p2] = this.pending;
    const save = this.loadSave(p1.join.name, p2.join.name);

    if (save) {
      this.restoreGame(save, p1, p2);
    } else {
      this.startNewGame(p1, p2);
    }
  }

  private addSpectator(ws: WebSocket, name: string): void {
    this.spectators.add(ws);
    console.log(`${name} joined as spectator`);
    this.send(ws, { type: 'assigned', playerId: 'spectator' as PlayerId });

    // Send current state immediately
    if (this.state) {
      const view = projectSpectatorView(this.state);
      this.send(ws, { type: 'state', view });
    }
  }

  private startNewGame(p1: PendingPlayer, p2: PendingPlayer): void {
    const p1Id = `p${++this.playerCounter}` as PlayerId;
    const p2Id = `p${++this.playerCounter}` as PlayerId;

    this.nameToPlayerId = {
      [p1.join.name]: p1Id as string,
      [p2.join.name]: p2Id as string,
    };

    const config: GameConfig = {
      players: [
        this.toPlayerConfig(p1, p1Id),
        this.toPlayerConfig(p2, p2Id),
      ],
      seed: Date.now(),
    };

    this.state = createGame(config, this.cardPool);

    this.registerPlayers(p1, p1Id, p2, p2Id);

    console.log('New game started!');
    console.log('\n' + formatGameState(this.state));

    this.broadcastState();
  }

  private restoreGame(save: GameSave, p1: PendingPlayer, p2: PendingPlayer): void {
    this.state = save.state;
    this.nameToPlayerId = save.nameToPlayerId;

    const p1Id = save.nameToPlayerId[p1.join.name] as PlayerId;
    const p2Id = save.nameToPlayerId[p2.join.name] as PlayerId;

    this.registerPlayers(p1, p1Id, p2, p2Id);

    console.log('Game restored from save!');
    console.log('\n' + formatGameState(this.state));

    this.broadcastState();
  }

  private registerPlayers(p1: PendingPlayer, p1Id: PlayerId, p2: PendingPlayer, p2Id: PlayerId): void {
    this.players.set(p1Id as string, { ws: p1.ws, playerId: p1Id, name: p1.join.name });
    this.players.set(p2Id as string, { ws: p2.ws, playerId: p2Id, name: p2.join.name });
    this.pending = [];

    this.send(p1.ws, { type: 'assigned', playerId: p1Id });
    this.send(p2.ws, { type: 'assigned', playerId: p2Id });
  }

  private toPlayerConfig(p: PendingPlayer, playerId: PlayerId): PlayerConfig {
    return {
      id: playerId,
      name: p.join.name,
      draftPool: p.join.draftPool,
      startingMinorItems: p.join.startingMinorItems,
      playDeck: p.join.playDeck,
      siteDeck: p.join.siteDeck,
      startingHavens: p.join.startingHavens,
    };
  }

  private handleAction(ws: WebSocket, action: GameAction): void {
    if (this.spectators.has(ws)) {
      this.send(ws, { type: 'error', message: 'Spectators cannot submit actions' });
      return;
    }

    if (!this.state) {
      this.send(ws, { type: 'error', message: 'Game not started' });
      return;
    }

    let playerId: PlayerId | null = null;
    for (const [, val] of this.players.entries()) {
      if (val.ws === ws) {
        playerId = val.playerId;
        break;
      }
    }

    if (!playerId) {
      this.send(ws, { type: 'error', message: 'Not a registered player' });
      return;
    }

    const actionWithPlayer = { ...action, player: playerId };

    // Capture draft state before the action for reveal detection
    const prevDraft = this.state.phaseState.phase === 'character-draft' ? this.state.phaseState : null;

    const result = reduce(this.state, actionWithPlayer);
    if (result.error) {
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    this.state = result.state;
    const { type: _type, player: _player, ...args } = actionWithPlayer;
    const argsStr = Object.keys(args).length > 0 ? ' ' + JSON.stringify(args) : '';
    console.log(`Action: ${actionWithPlayer.type} by ${playerId}${argsStr}`);
    console.log('\n' + formatGameState(this.state));

    // Detect draft round reveal: round advanced or draft ended
    if (prevDraft) {
      const newDraft = this.state.phaseState.phase === 'character-draft' ? this.state.phaseState : null;
      const roundAdvanced = newDraft && newDraft.round > prevDraft.round;
      const draftEnded = !newDraft; // transitioned out of draft phase

      if (roundAdvanced || draftEnded) {
        const pick0 = prevDraft.draftState[0].currentPick;
        const pick1 = prevDraft.draftState[1].currentPick;
        const collision = pick0 !== null && pick1 !== null && pick0 === pick1;

        const revealMsg: ServerMessage = {
          type: 'draft-reveal',
          player1Name: this.state.players[0].name,
          player1Pick: pick0,
          player2Name: this.state.players[1].name,
          player2Pick: pick1,
          collision,
        };

        this.broadcastToAll(revealMsg);
      }
    }

    this.broadcastState();
  }

  // ---- Disconnect / Save / Restore ----

  private handleDisconnect(ws: WebSocket): void {
    // Remove spectator
    if (this.spectators.delete(ws)) {
      console.log('Spectator disconnected');
      return;
    }

    // Remove from pending
    const wasPending = this.pending.length;
    this.pending = this.pending.filter(p => p.ws !== ws);
    if (this.pending.length < wasPending) {
      console.log('Pending player disconnected');
      return;
    }

    // Find the disconnected active player
    let disconnectedName: string | null = null;
    let disconnectedId: string | null = null;
    for (const [key, val] of this.players.entries()) {
      if (val.ws === ws) {
        disconnectedName = val.name;
        disconnectedId = key;
        break;
      }
    }

    if (!disconnectedId || !disconnectedName) return;

    console.log(`${disconnectedName} disconnected`);

    // Save the game if one is in progress
    if (this.state) {
      this.saveGame();
    }

    // Notify the other player and disconnect them
    this.players.delete(disconnectedId);
    for (const [key, val] of this.players.entries()) {
      this.send(val.ws, { type: 'disconnected', message: `${disconnectedName} disconnected. Game saved.` });
      val.ws.close();
      this.players.delete(key);
    }

    // Reset session for next pair
    this.state = null;
    this.nameToPlayerId = {};
  }

  /** Generates a deterministic save file path from two player names. */
  private saveFilePath(name1: string, name2: string): string {
    const key = [name1, name2].sort().join('_vs_');
    return path.join(SAVE_DIR, `${key}.json`);
  }

  private saveGame(): void {
    if (!this.state) return;

    const names = Object.keys(this.nameToPlayerId);
    if (names.length !== 2) return;

    const savePath = this.saveFilePath(names[0], names[1]);
    const save: GameSave = {
      state: this.state,
      nameToPlayerId: this.nameToPlayerId,
    };

    fs.writeFileSync(savePath, JSON.stringify(save), 'utf-8');
    console.log(`Game saved to ${savePath}`);
  }

  private loadSave(name1: string, name2: string): GameSave | null {
    const savePath = this.saveFilePath(name1, name2);
    if (!fs.existsSync(savePath)) return null;

    try {
      const data = fs.readFileSync(savePath, 'utf-8');
      const save = JSON.parse(data) as GameSave;

      // Verify both player names are in the save
      if (!(name1 in save.nameToPlayerId) || !(name2 in save.nameToPlayerId)) {
        return null;
      }

      // Restore the card pool (it's not serialised — always loaded fresh)
      save.state = { ...save.state, cardPool: this.cardPool };

      // Delete the save file after loading (one-time restore)
      fs.unlinkSync(savePath);
      console.log(`Loaded save from ${savePath}`);

      return save;
    } catch {
      return null;
    }
  }

  private broadcastState(): void {
    if (!this.state) return;

    // Players get their own projected view
    for (const [, { ws, playerId }] of this.players.entries()) {
      const view = projectPlayerView(this.state, playerId);
      this.send(ws, { type: 'state', view });
    }

    // Spectators get a view with both players' hands hidden
    if (this.spectators.size > 0) {
      const spectatorView = projectSpectatorView(this.state);
      for (const ws of this.spectators) {
        this.send(ws, { type: 'state', view: spectatorView });
      }
    }
  }

  /** Sends a message to all players and spectators. */
  private broadcastToAll(msg: ServerMessage): void {
    for (const [, { ws }] of this.players.entries()) {
      this.send(ws, msg);
    }
    for (const ws of this.spectators) {
      this.send(ws, msg);
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) {
      const json = JSON.stringify(msg);
      if (this.debug) {
        console.log(colorDebug(`>> ${json}`));
      }
      ws.send(json);
    }
  }
}
