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
import * as os from 'os';
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
import { formatGameState, loadCardPool, colorDebug, DEBUG_JSON_COMPACT_LIMIT, STATE_DIVIDER, createRng } from '@meccg/shared';
import { createGame } from '../engine/init.js';
import type { PlayerConfig, GameConfig } from '../engine/init.js';
import { reduce } from '../engine/reducer.js';
import { projectPlayerView, projectSpectatorView } from './projection.js';
import { ServerLog, GameLog } from './game-log.js';

const SAVE_DIR = process.env.SAVE_DIR ?? path.join(os.homedir(), '.meccg', 'saves');

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
  private serverLog: ServerLog;
  private gameLog: GameLog;

  constructor(options: GameSessionOptions) {
    this.debug = options.debug ?? false;
    this.playerNames = new Set(options.playerNames.map(n => n.toLowerCase()));
    this.cardPool = loadCardPool();
    fs.mkdirSync(SAVE_DIR, { recursive: true });
    this.serverLog = new ServerLog();
    this.gameLog = new GameLog();
    this.serverLog.log('boot', { players: options.playerNames, debug: this.debug });
  }

  addConnection(ws: WebSocket): void {
    this.serverLog.log('connect');

    ws.on('message', (raw: Buffer) => {
      try {
        const data = raw.toString();
        if (this.debug) {
          const display = data.length > DEBUG_JSON_COMPACT_LIMIT ? JSON.stringify(JSON.parse(data), null, 2) : data;
          console.log(colorDebug(`<< ${display}`));
        }
        const msg: ClientMessage = JSON.parse(data) as ClientMessage;
        this.serverLog.log('msg-in', { msgType: msg.type, from: this.identifyWs(ws), msg });
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
    this.serverLog.log('shutdown');
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
    this.serverLog.close();
    this.gameLog.close();
  }

  private handleMessage(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case 'join':
        this.handleJoin(ws, msg);
        break;
      case 'action':
        this.handleAction(ws, msg.action);
        break;
      case 'reset':
        this.handleReset();
        break;
      case 'save':
        this.saveGame();
        this.saveBackup();
        break;
      case 'load':
        this.handleLoad();
        break;
      case 'reseed':
        this.handleReseed();
        break;
    }
  }

  private handleJoin(ws: WebSocket, msg: JoinMessage): void {
    // Validate player name: alphanumeric, spaces, hyphens, underscores only
    if (!/^[a-zA-Z0-9 _-]+$/.test(msg.name)) {
      this.send(ws, { type: 'error', message: 'Invalid name: only letters, numbers, spaces, hyphens, and underscores allowed' });
      return;
    }

    const normalizedName = msg.name.toLowerCase();

    // Not a designated player → spectator
    if (!this.playerNames.has(normalizedName)) {
      this.addSpectator(ws, msg.name);
      return;
    }

    // Already connected with this name
    for (const [, player] of this.players.entries()) {
      if (player.name.toLowerCase() === normalizedName) {
        this.send(ws, { type: 'error', message: `Player "${msg.name}" is already connected` });
        return;
      }
    }

    // Already pending with this name
    if (this.pending.has(normalizedName)) {
      this.send(ws, { type: 'error', message: `Player "${msg.name}" is already waiting` });
      return;
    }

    this.pending.set(normalizedName, { ws, join: msg });
    console.log(`${msg.name} joined as player`);

    if (this.pending.size < 2) {
      this.send(ws, { type: 'waiting' });
      return;
    }

    // Both players present — try restore or start new
    const keys = [...this.playerNames];
    const p1 = this.pending.get(keys[0])!;
    const p2 = this.pending.get(keys[1])!;
    // Use the original display name from the join message
    const name1 = p1.join.name;
    const name2 = p2.join.name;
    const save = this.loadSave(keys[0], keys[1]);

    if (save) {
      this.restoreGame(save, p1, p2, name1, name2);
    } else {
      this.startNewGame(p1, p2, name1, name2);
    }
  }

  private addSpectator(ws: WebSocket, name: string): void {
    this.spectators.add(ws);
    console.log(`${name} joined as spectator`);
    this.send(ws, { type: 'assigned', playerId: 'spectator' as PlayerId, gameId: this.state?.gameId ?? 'unknown' });

    if (this.state) {
      const view = projectSpectatorView(this.state);
      this.send(ws, { type: 'state', view });
    }
  }

  private startNewGame(p1: PendingPlayer, p2: PendingPlayer, name1: string, name2: string): void {
    const p1Id = `p${++this.playerCounter}` as PlayerId;
    const p2Id = `p${++this.playerCounter}` as PlayerId;

    this.nameToPlayerId = { [name1.toLowerCase()]: p1Id as string, [name2.toLowerCase()]: p2Id as string };

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
    console.log(`\n${STATE_DIVIDER}\n${formatGameState(this.state)}\n${STATE_DIVIDER}`);
    this.serverLog.log('new-game', { gameId: this.state.gameId, player1: name1, player2: name2 });
    this.gameLog.open(this.state.gameId);
    this.logState('new-game');

    this.broadcastState();
  }

  private restoreGame(save: GameSave, p1: PendingPlayer, p2: PendingPlayer, name1: string, name2: string): void {
    this.state = save.state;
    // Normalize saved name-to-ID map to lowercase keys
    const normalizedMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(save.nameToPlayerId)) {
      normalizedMap[k.toLowerCase()] = v;
    }
    this.nameToPlayerId = normalizedMap;

    const p1Id = normalizedMap[name1.toLowerCase()] as PlayerId;
    const p2Id = normalizedMap[name2.toLowerCase()] as PlayerId;

    this.registerPlayers(p1, p1Id, name1, p2, p2Id, name2);

    console.log('Game restored from save!');
    this.serverLog.log('restore', { gameId: this.state.gameId, stateSeq: this.state.stateSeq, player1: name1, player2: name2 });
    this.gameLog.open(this.state.gameId);
    this.gameLog.truncateAfterSeq(this.state.stateSeq);
    this.gameLog.log('restore', { stateSeq: this.state.stateSeq, player1: name1, player2: name2 });
    console.log(`\n${STATE_DIVIDER}\n${formatGameState(this.state)}\n${STATE_DIVIDER}`);

    this.broadcastState();
  }

  private registerPlayers(
    p1: PendingPlayer, p1Id: PlayerId, name1: string,
    p2: PendingPlayer, p2Id: PlayerId, name2: string,
  ): void {
    this.players.set(p1Id as string, { ws: p1.ws, playerId: p1Id, name: name1 });
    this.players.set(p2Id as string, { ws: p2.ws, playerId: p2Id, name: name2 });
    this.pending.clear();

    const gameId = this.state?.gameId ?? 'unknown';
    this.send(p1.ws, { type: 'assigned', playerId: p1Id, gameId });
    this.send(p2.ws, { type: 'assigned', playerId: p2Id, gameId });
  }

  private toPlayerConfig(p: PendingPlayer, playerId: PlayerId, name: string): PlayerConfig {
    return {
      id: playerId,
      name,
      alignment: p.join.alignment,
      draftPool: p.join.draftPool,
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
    const prevDraft = this.state.phaseState.phase === 'setup' && this.state.phaseState.setupStep.step === 'character-draft'
      ? this.state.phaseState.setupStep : null;

    const result = reduce(this.state, actionWithPlayer);
    if (result.error) {
      this.serverLog.log('action', { action: actionWithPlayer, error: result.error });
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    this.state = result.state;
    const { type: _type, player: _player, ...args } = actionWithPlayer;
    const argsStr = Object.keys(args).length > 0 ? ' ' + JSON.stringify(args) : '';
    console.log(`Action: ${actionWithPlayer.type} by ${playerId}${argsStr}`);
    console.log(`\n${STATE_DIVIDER}\n${formatGameState(this.state)}\n${STATE_DIVIDER}`);
    this.serverLog.log('action', { action: actionWithPlayer });
    this.logState(actionWithPlayer.type);

    // Detect draft round reveal
    if (prevDraft) {
      const newDraft = this.state.phaseState.phase === 'setup' && this.state.phaseState.setupStep.step === 'character-draft'
        ? this.state.phaseState.setupStep : null;
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

    // Broadcast any visual effects from the reducer
    if (result.effects && result.effects.length > 0) {
      for (const effect of result.effects) {
        console.log(`Effect: ${effect.effect} — ${JSON.stringify(effect)}`);
        this.broadcastToAll({ type: 'effect', effect });
      }
    }

    this.broadcastState();
  }

  /** Log a state snapshot to the per-game log. */
  private logState(reason: string): void {
    if (this.state) {
      this.gameLog.log('state', {
        stateSeq: this.state.stateSeq,
        reason,
        turn: this.state.turnNumber,
        phase: this.state.phaseState.phase,
        step: this.state.phaseState.phase === 'setup' ? this.state.phaseState.setupStep.step : null,
        activePlayer: this.state.activePlayer,
        state: this.state,
      });
    }
  }

  private handleReset(): void {
    this.serverLog.log('reset');
    // Delete save file
    const savePath = this.saveFilePath();
    if (fs.existsSync(savePath)) {
      fs.unlinkSync(savePath);
      console.log(`Deleted save: ${savePath}`);
    }

    // Clear game state
    this.state = null;

    // Force all clients to reconnect
    const restartMsg: ServerMessage = { type: 'restart', message: 'Game reset. Reconnecting...' };

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

    this.nameToPlayerId = {};
    console.log('Game reset');
  }

  private handleReseed(): void {
    if (!this.state) return;
    const newSeed = Date.now() ^ Math.floor(Math.random() * 0x7fffffff);
    this.state = { ...this.state, rng: createRng(newSeed) };
    console.log(`RNG re-seeded with ${newSeed}`);
    this.broadcastState();
  }

  // ---- Disconnect / Save / Restore ----

  private handleDisconnect(ws: WebSocket): void {
    const who = this.identifyWs(ws);
    this.serverLog.log('disconnect', { who });

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
    this.serverLog.log('save', { path: savePath, stateSeq: this.state.stateSeq });
  }

  private handleLoad(): void {
    this.serverLog.log('load');
    const savePath = this.saveFilePath();
    const backupPath = savePath.replace(/\.json$/, '-saved.json');
    if (!fs.existsSync(backupPath)) {
      console.log('No backup save found');
      return;
    }
    fs.copyFileSync(backupPath, savePath);
    console.log(`Loaded backup from ${backupPath}`);

    // Clear state and restart all clients so they reconnect and load the save
    this.state = null;
    const restartMsg: ServerMessage = { type: 'restart', message: 'Loading saved game. Reconnecting...' };
    for (const [, { ws }] of this.pending.entries()) { this.send(ws, restartMsg); ws.close(); }
    this.pending.clear();
    for (const [, { ws }] of this.players.entries()) { this.send(ws, restartMsg); ws.close(); }
    this.players.clear();
    for (const ws of this.spectators) { this.send(ws, restartMsg); ws.close(); }
    this.spectators.clear();
    this.nameToPlayerId = {};
  }

  private saveBackup(): void {
    const savePath = this.saveFilePath();
    const backupPath = savePath.replace(/\.json$/, '-saved.json');
    if (fs.existsSync(savePath)) {
      fs.copyFileSync(savePath, backupPath);
      console.log(`Backup saved to ${backupPath}`);
    }
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

  /** Identify a WebSocket connection by player name or role. */
  private identifyWs(ws: WebSocket): string {
    for (const [, p] of this.players.entries()) {
      if (p.ws === ws) return p.name;
    }
    for (const [name, p] of this.pending.entries()) {
      if (p.ws === ws) return name;
    }
    if (this.spectators.has(ws)) return 'spectator';
    return 'unknown';
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) {
      const json = JSON.stringify(msg);
      if (this.debug) {
        const display = json.length > DEBUG_JSON_COMPACT_LIMIT ? JSON.stringify(msg, null, 2) : json;
        console.log(colorDebug(`>> ${display}`));
      }
      // Log outgoing messages (skip 'state' — logged separately as snapshots)
      if (msg.type !== 'state') {
        this.serverLog.log('msg-out', { msgType: msg.type, to: this.identifyWs(ws), msg });
      }
      ws.send(json);
    }
  }
}
