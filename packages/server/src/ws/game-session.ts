/**
 * @module game-session
 *
 * Manages a single MECCG game between two fixed players over WebSocket.
 *
 * Player names are set at construction. Only clients joining with those
 * names become players; all others are spectators. On disconnect, the
 * game is saved. When both players reconnect, the game resumes.
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
import { formatGameState, loadCardPool, colorDebug, stripCardMarkers } from '@meccg/shared';
import { createGame } from '../engine/init.js';
import type { PlayerConfig, GameConfig } from '../engine/init.js';
import { reduce } from '../engine/reducer.js';
import { projectPlayerView, projectSpectatorView } from './projection.js';

const SAVE_DIR = process.env.SAVE_DIR ?? path.join(process.cwd(), 'saves');

interface PendingPlayer {
  ws: WebSocket;
  join: JoinMessage;
}

interface GameSave {
  state: GameState;
  nameToPlayerId: Record<string, string>;
}

export interface GameSessionOptions {
  debug?: boolean;
  playerNames: [string, string];
}

/**
 * A single game between two fixed players. Anyone else connecting is
 * a spectator. On disconnect, the game is saved and can be resumed
 * when the same players reconnect.
 */
export class GameSession {
  private state: GameState | null = null;
  private players: Map<string, { ws: WebSocket; playerId: PlayerId; name: string }> = new Map();
  private spectators: Set<WebSocket> = new Set();
  private pending: Map<string, PendingPlayer> = new Map();
  private cardPool: Readonly<Record<string, CardDefinition>>;
  private nameToPlayerId: Record<string, string> = {};
  private playerCounter = 0;
  private debug: boolean;
  private playerNames: Set<string>;

  constructor(options: GameSessionOptions) {
    this.debug = options.debug ?? false;
    this.playerNames = new Set(options.playerNames);
    this.cardPool = loadCardPool();
    fs.mkdirSync(SAVE_DIR, { recursive: true });
  }

  addConnection(ws: WebSocket): void {
    ws.on('message', (raw: Buffer) => {
      try {
        const data = raw.toString();
        if (this.debug) {
          console.log(colorDebug(`<< ${data}`));
        }
        const msg: ClientMessage = JSON.parse(data) as ClientMessage;
        this.handleMessage(ws, msg);
      } catch {
        this.send(ws, { type: 'error', message: 'Invalid message format' });
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(ws);
    });
  }

  gracefulShutdown(): void {
    if (this.state) {
      this.saveGame();
    }

    const restartMsg: ServerMessage = { type: 'restart', message: 'Server restarting. Reconnecting...' };

    for (const [, { ws }] of this.pending.entries()) {
      this.send(ws, restartMsg);
      ws.close();
    }
    this.pending.clear();

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
    // Not a designated player → spectator
    if (!this.playerNames.has(msg.name)) {
      this.addSpectator(ws, msg.name);
      return;
    }

    // Already connected with this name
    for (const [, player] of this.players.entries()) {
      if (player.name === msg.name) {
        this.send(ws, { type: 'error', message: `Player "${msg.name}" is already connected` });
        return;
      }
    }

    // Already pending with this name
    if (this.pending.has(msg.name)) {
      this.send(ws, { type: 'error', message: `Player "${msg.name}" is already waiting` });
      return;
    }

    this.pending.set(msg.name, { ws, join: msg });
    console.log(`${msg.name} joined as player`);

    if (this.pending.size < 2) {
      this.send(ws, { type: 'waiting' });
      return;
    }

    // Both players present — try restore or start new
    const names = [...this.playerNames];
    const p1 = this.pending.get(names[0])!;
    const p2 = this.pending.get(names[1])!;
    const save = this.loadSave(names[0], names[1]);

    if (save) {
      this.restoreGame(save, p1, p2, names[0], names[1]);
    } else {
      this.startNewGame(p1, p2, names[0], names[1]);
    }
  }

  private addSpectator(ws: WebSocket, name: string): void {
    this.spectators.add(ws);
    console.log(`${name} joined as spectator`);
    this.send(ws, { type: 'assigned', playerId: 'spectator' as PlayerId });

    if (this.state) {
      const view = projectSpectatorView(this.state);
      this.send(ws, { type: 'state', view });
    }
  }

  private startNewGame(p1: PendingPlayer, p2: PendingPlayer, name1: string, name2: string): void {
    const p1Id = `p${++this.playerCounter}` as PlayerId;
    const p2Id = `p${++this.playerCounter}` as PlayerId;

    this.nameToPlayerId = { [name1]: p1Id as string, [name2]: p2Id as string };

    const config: GameConfig = {
      players: [
        this.toPlayerConfig(p1, p1Id, name1),
        this.toPlayerConfig(p2, p2Id, name2),
      ],
      seed: Date.now(),
    };

    this.state = createGame(config, this.cardPool);
    this.registerPlayers(p1, p1Id, name1, p2, p2Id, name2);

    console.log('New game started!');
    console.log('\n' + stripCardMarkers(formatGameState(this.state)));

    this.broadcastState();
  }

  private restoreGame(save: GameSave, p1: PendingPlayer, p2: PendingPlayer, name1: string, name2: string): void {
    this.state = save.state;
    this.nameToPlayerId = save.nameToPlayerId;

    const p1Id = save.nameToPlayerId[name1] as PlayerId;
    const p2Id = save.nameToPlayerId[name2] as PlayerId;

    this.registerPlayers(p1, p1Id, name1, p2, p2Id, name2);

    console.log('Game restored from save!');
    console.log('\n' + stripCardMarkers(formatGameState(this.state)));

    this.broadcastState();
  }

  private registerPlayers(
    p1: PendingPlayer, p1Id: PlayerId, name1: string,
    p2: PendingPlayer, p2Id: PlayerId, name2: string,
  ): void {
    this.players.set(p1Id as string, { ws: p1.ws, playerId: p1Id, name: name1 });
    this.players.set(p2Id as string, { ws: p2.ws, playerId: p2Id, name: name2 });
    this.pending.clear();

    this.send(p1.ws, { type: 'assigned', playerId: p1Id });
    this.send(p2.ws, { type: 'assigned', playerId: p2Id });
  }

  private toPlayerConfig(p: PendingPlayer, playerId: PlayerId, name: string): PlayerConfig {
    return {
      id: playerId,
      name,
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
    console.log('\n' + stripCardMarkers(formatGameState(this.state)));

    // Detect draft round reveal
    if (prevDraft) {
      const newDraft = this.state.phaseState.phase === 'character-draft' ? this.state.phaseState : null;
      const roundAdvanced = newDraft && newDraft.round > prevDraft.round;
      const draftEnded = !newDraft;

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
    if (this.spectators.delete(ws)) {
      console.log('Spectator disconnected');
      return;
    }

    // Remove from pending
    for (const [name, p] of this.pending.entries()) {
      if (p.ws === ws) {
        this.pending.delete(name);
        console.log(`${name} disconnected (was pending)`);
        return;
      }
    }

    // Find disconnected active player
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

    if (this.state) {
      this.saveGame();
    }

    // Notify other player and spectators, disconnect everyone
    this.players.delete(disconnectedId);
    for (const [key, val] of this.players.entries()) {
      this.send(val.ws, { type: 'disconnected', message: `${disconnectedName} disconnected. Game saved.` });
      val.ws.close();
      this.players.delete(key);
    }
    for (const ws of this.spectators) {
      this.send(ws, { type: 'disconnected', message: `${disconnectedName} disconnected. Game saved.` });
      ws.close();
    }
    this.spectators.clear();

    this.state = null;
    this.nameToPlayerId = {};
  }

  private saveFilePath(): string {
    const names = [...this.playerNames].sort();
    const key = names.join('_vs_');
    return path.join(SAVE_DIR, `${key}.json`);
  }

  private saveGame(): void {
    if (!this.state) return;

    const savePath = this.saveFilePath();
    const save: GameSave = {
      state: this.state,
      nameToPlayerId: this.nameToPlayerId,
    };

    fs.writeFileSync(savePath, JSON.stringify(save), 'utf-8');
    console.log(`Game saved to ${savePath}`);
  }

  private loadSave(name1: string, name2: string): GameSave | null {
    const savePath = this.saveFilePath();
    if (!fs.existsSync(savePath)) return null;

    try {
      const data = fs.readFileSync(savePath, 'utf-8');
      const save = JSON.parse(data) as GameSave;

      if (!(name1 in save.nameToPlayerId) || !(name2 in save.nameToPlayerId)) {
        return null;
      }

      save.state = { ...save.state, cardPool: this.cardPool };
      fs.unlinkSync(savePath);
      console.log(`Loaded save from ${savePath}`);

      return save;
    } catch {
      return null;
    }
  }

  private broadcastState(): void {
    if (!this.state) return;

    for (const [, { ws, playerId }] of this.players.entries()) {
      const view = projectPlayerView(this.state, playerId);
      this.send(ws, { type: 'state', view });
    }

    if (this.spectators.size > 0) {
      const spectatorView = projectSpectatorView(this.state);
      for (const ws of this.spectators) {
        this.send(ws, { type: 'state', view: spectatorView });
      }
    }
  }

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
