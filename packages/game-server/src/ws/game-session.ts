/**
 * @module game-session
 *
 * Manages a single MECCG game between two fixed players over WebSocket.
 *
 * Player names are set at construction. Only clients joining with those
 * names become players; all others are spectators. On disconnect, the
 * game is saved. When both players reconnect, the game resumes.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type WebSocket from 'ws';
import type {
  GameState,
  PlayerState,
  PlayerId,
  CardInstanceId,
  CardDefinitionId,
  CardDefinition,
  ClientMessage,
  ServerMessage,
  JoinMessage,
  GameAction,
} from '@meccg/shared';
import { loadCardPool, createRng, buildMovementMap, createGame, reduce, startCapture, flushCapture, Phase, computeTournamentBreakdown } from '@meccg/shared';
import type { MovementMap, PlayerConfig, GameConfig } from '@meccg/shared';
import { projectPlayerView, projectSpectatorView } from './projection.js';
import { ServerLog, GameLog } from './game-log.js';

const SAVE_DIR = process.env.SAVE_DIR ?? path.join(os.homedir(), '.meccg', 'saves');
const SNAPSHOT_DIR = path.join(__dirname, '../../data/dev/snapshots');
const PLAYERS_DIR = path.join(os.homedir(), '.meccg', 'players');

interface PendingPlayer {
  ws: WebSocket;
  join: JoinMessage;
}

interface GameSave {
  state: GameState;
  nameToPlayerId: Record<string, string>;
}

export interface GameSessionOptions {
  /** Enable development-mode operations (undo, save, load, reseed, reset). */
  dev?: boolean;
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
  /** When false, dev-only operations (undo, save, load, reseed, reset) are refused. */
  private dev: boolean;
  private playerNames: Set<string>;
  private serverLog: ServerLog;
  private gameLog: GameLog;
  /** History of previous states for undo support. */
  private stateHistory: GameState[] = [];
  /** Precomputed movement map for region/starter movement queries. */
  private movementMap: MovementMap;

  constructor(options: GameSessionOptions) {
    this.dev = options.dev ?? false;
    this.playerNames = new Set(options.playerNames.map(n => n.toLowerCase()));
    this.cardPool = loadCardPool();
    this.movementMap = buildMovementMap(this.cardPool);
    fs.mkdirSync(SAVE_DIR, { recursive: true });
    this.serverLog = new ServerLog();
    this.gameLog = new GameLog();
    this.serverLog.log('boot', { players: options.playerNames, dev: this.dev });
  }

  addConnection(ws: WebSocket): void {
    this.serverLog.log('connect');

    ws.on('message', (raw: Buffer) => {
      try {
        const data = raw.toString();
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
      this.writeSave(this.autosaveFilePath());
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
      case 'save':
      case 'load':
      case 'reseed':
      case 'undo':
      case 'cheat-roll':
      case 'summon-card':
      case 'load-snapshot':
        if (!this.dev) {
          this.send(ws, { type: 'error', message: `'${msg.type}' is only available in development mode (--dev)` });
          break;
        }
        if (msg.type === 'reset') this.handleReset();
        else if (msg.type === 'save') { this.writeSave(this.saveFilePath()); this.send(ws, { type: 'info', message: 'Game saved.' }); }
        else if (msg.type === 'load') this.handleLoad();
        else if (msg.type === 'reseed') this.handleReseed(ws);
        else if (msg.type === 'undo') this.handleUndo(ws);
        else if (msg.type === 'cheat-roll') this.handleCheatRoll(ws, msg.total);
        else if (msg.type === 'summon-card') this.handleSummonCard(ws, msg.cardName);
        else if (msg.type === 'load-snapshot') this.handleLoadSnapshot(ws, msg.file);
        break;
    }
  }

  private handleJoin(ws: WebSocket, msg: JoinMessage): void {
    // JWT token verification — when JWT_SECRET is set (lobby mode), require a valid token
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret && !this.verifyJoinToken(ws, msg)) return;

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

    // Already connected with this name — replace the old connection
    for (const [playerId, player] of this.players.entries()) {
      if (player.name.toLowerCase() === normalizedName) {
        this.serverLog.log('reconnect-replace', { name: msg.name, playerId });
        player.ws.close();
        this.players.set(playerId, { ws, playerId: playerId as PlayerId, name: player.name });
        ws.on('close', () => this.handleDisconnect(ws));
        this.send(ws, { type: 'assigned', playerId: playerId as PlayerId, gameId: this.state?.gameId ?? 'unknown' });
        if (this.state) this.broadcastState();
        return;
      }
    }

    // Already pending with this name
    if (this.pending.has(normalizedName)) {
      this.send(ws, { type: 'error', message: `Player "${msg.name}" is already waiting` });
      return;
    }

    // Game is in progress with a player slot open — reconnect immediately
    if (this.state) {
      const playerId = this.nameToPlayerId[normalizedName];
      if (playerId) {
        this.serverLog.log('reconnect', { name: msg.name, playerId });
        this.players.set(playerId, { ws, playerId: playerId as PlayerId, name: msg.name });
        ws.on('close', () => this.handleDisconnect(ws));
        this.send(ws, { type: 'assigned', playerId: playerId as PlayerId, gameId: this.state.gameId ?? 'unknown' });
        this.broadcastState();
        return;
      }
    }

    this.pending.set(normalizedName, { ws, join: msg });
    this.serverLog.log('join', { name: msg.name, role: 'player' });

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

  /**
   * Verify the JWT token on a join message when running in lobby mode.
   * Returns true if valid (or if no JWT_SECRET is set), false if rejected.
   */
  private verifyJoinToken(ws: WebSocket, msg: JoinMessage): boolean {
    if (!msg.token) {
      this.send(ws, { type: 'error', message: 'Authentication token required' });
      return false;
    }
    try {
      const secret = process.env.JWT_SECRET!;
      const parts = msg.token.split('.');
      if (parts.length !== 3) throw new Error('Malformed token');
      const [header, body, sig] = parts;
      const expected = crypto.createHmac('sha256', secret)
        .update(`${header}.${body}`)
        .digest('base64url');
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        throw new Error('Invalid signature');
      }
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as { sub: string; exp: number };
      if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
      if (payload.sub.toLowerCase() !== msg.name.toLowerCase()) {
        throw new Error(`Token name mismatch: "${payload.sub}" vs "${msg.name}"`);
      }
      return true;
    } catch (err) {
      this.send(ws, { type: 'error', message: `Authentication failed: ${(err as Error).message}` });
      return false;
    }
  }

  private addSpectator(ws: WebSocket, name: string): void {
    this.spectators.add(ws);
    this.serverLog.log('join', { name, role: 'spectator' });
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

    this.serverLog.log('new-game', { gameId: this.state.gameId, player1: name1, player2: name2 });
    this.gameLog.open(this.state.gameId);
    this.gameLog.writeStaticData(
      this.state.cardPool as unknown as Record<string, unknown>,
      this.state.instanceMap as unknown as Record<string, { definitionId: string }>,
    );
    this.logState('new-game');

    this.broadcastStateWithLogs();
  }

  private restoreGame(save: GameSave, p1: PendingPlayer, p2: PendingPlayer, name1: string, name2: string): void {
    this.state = { ...save.state, chain: save.state.chain ?? null, combat: save.state.combat ?? null };
    // Normalize saved name-to-ID map to lowercase keys
    const normalizedMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(save.nameToPlayerId)) {
      normalizedMap[k.toLowerCase()] = v;
    }
    this.nameToPlayerId = normalizedMap;

    const p1Id = normalizedMap[name1.toLowerCase()] as PlayerId;
    const p2Id = normalizedMap[name2.toLowerCase()] as PlayerId;

    this.registerPlayers(p1, p1Id, name1, p2, p2Id, name2);

    this.serverLog.log('restore', { gameId: this.state.gameId, stateSeq: this.state.stateSeq, player1: name1, player2: name2 });
    this.gameLog.open(this.state.gameId);
    this.gameLog.writeStaticData(
      this.state.cardPool as unknown as Record<string, unknown>,
      this.state.instanceMap as unknown as Record<string, { definitionId: string }>,
    );
    this.gameLog.truncateAfterSeq(this.state.stateSeq);

    // Repair null lastDiceRoll from saves written by old code that cleared dice on shutdown.
    // Recover the correct values from the game log's state entry for this seq.
    if (this.state.players.some(p => p.lastDiceRoll === null)) {
      const logEntry = this.gameLog.readStateAt(this.state.stateSeq);
      if (logEntry) {
        const logPlayers = (logEntry as { players?: { lastDiceRoll?: unknown }[] }).players;
        if (logPlayers) {
          const players = [...this.state.players] as [PlayerState, PlayerState];
          for (let i = 0; i < 2; i++) {
            if (players[i].lastDiceRoll === null && logPlayers[i]?.lastDiceRoll) {
              players[i] = { ...players[i], lastDiceRoll: logPlayers[i].lastDiceRoll as PlayerState['lastDiceRoll'] };
            }
          }
          this.state = { ...this.state, players };
        }
      }
    }

    // Rebuild undo history from the game log
    const logStates = this.gameLog.readStatesBefore(this.state.stateSeq);
    this.stateHistory = logStates.map(s => ({
      ...s,
      cardPool: this.state!.cardPool,
      instanceMap: this.state!.instanceMap,
    }) as GameState);
    this.gameLog.log('restore', { stateSeq: this.state.stateSeq, player1: name1, player2: name2 });

    this.broadcastStateWithLogs();
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
      sideboard: p.join.sideboard,
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

    // Start capturing engine log output before reduce() so both reducer
    // validation logging and legal-actions logging are collected.
    if (this.dev) startCapture();

    const result = reduce(this.state, actionWithPlayer);
    if (result.error) {
      if (this.dev) flushCapture();  // discard captured lines on error
      this.serverLog.log('action', { action: actionWithPlayer, error: result.error });
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    // Save previous state for undo before applying
    this.stateHistory.push(this.state);
    this.state = result.state;
    this.serverLog.log('action', { action: actionWithPlayer });
    this.logState(actionWithPlayer.type, actionWithPlayer as unknown as Record<string, unknown>);

    // When a player sends 'finished', record the game result to their history file
    if (actionWithPlayer.type === 'finished') {
      this.recordGameResult(playerId);
    }

    // Detect draft round reveal
    if (prevDraft) {
      const newDraft = this.state.phaseState.phase === 'setup' && this.state.phaseState.setupStep.step === 'character-draft'
        ? this.state.phaseState.setupStep : null;
      const roundAdvanced = newDraft && newDraft.round > prevDraft.round;
      const draftEnded = !newDraft;

      if (roundAdvanced || draftEnded) {
        const pick0 = prevDraft.draftState[0].currentPick;
        const pick1 = prevDraft.draftState[1].currentPick;
        const def0 = pick0 !== null ? this.state.instanceMap[pick0 as string]?.definitionId : null;
        const def1 = pick1 !== null ? this.state.instanceMap[pick1 as string]?.definitionId : null;
        const collision = def0 !== null && def1 !== null && def0 === def1;

        const revealMsg: ServerMessage = {
          type: 'draft-reveal',
          player1Name: this.state.players[0].name,
          player1Pick: def0,
          player2Name: this.state.players[1].name,
          player2Pick: def1,
          collision,
        };

        this.broadcastToAll(revealMsg);
      }
    }

    // Broadcast any visual effects from the reducer
    if (result.effects && result.effects.length > 0) {
      for (const effect of result.effects) {
        this.broadcastToAll({ type: 'effect', effect });
      }
    }

    // broadcastState triggers computeLegalActions logging — capture continues
    this.broadcastState();

    // Flush all captured log lines (from reduce + broadcastState) to clients
    if (this.dev) {
      const lines = flushCapture();
      if (lines.length > 0) {
        this.broadcastToAll({ type: 'log', lines });
      }
    }
  }

  /** Undo the most recent action and revert to the previous game state. */
  private handleUndo(ws: WebSocket): void {
    if (this.stateHistory.length === 0) {
      this.send(ws, { type: 'error', message: 'Nothing to undo' });
      return;
    }

    const previous = this.stateHistory.pop()!;
    const fromSeq = this.state?.stateSeq;
    this.serverLog.log('undo', { fromSeq, toSeq: previous.stateSeq });

    // Remove the current state's entry from the game log
    if (fromSeq !== undefined) {
      this.gameLog.removeLastEntry(fromSeq);
    }
    this.state = previous;
    this.broadcastStateWithLogs();
    this.send(ws, { type: 'info', message: 'Undo.' });
  }

  /** Log a state snapshot to the per-game log. */
  private logState(reason: string, action?: Record<string, unknown>): void {
    if (this.state) {
      const { cardPool: _cardPool, instanceMap: _instanceMap, ...stateWithoutStatic } = this.state;
      this.gameLog.log('state', {
        stateSeq: this.state.stateSeq,
        reason,
        ...(action ? { action } : {}),
        turn: this.state.turnNumber,
        phase: this.state.phaseState.phase,
        step: this.state.phaseState.phase === 'setup' ? this.state.phaseState.setupStep.step : null,
        activePlayer: this.state.activePlayer,
        state: stateWithoutStatic,
      });
    }
  }

  private handleReset(): void {
    this.serverLog.log('reset');
    // Delete save files
    for (const savePath of [this.saveFilePath(), this.autosaveFilePath()]) {
      if (fs.existsSync(savePath)) {
        fs.unlinkSync(savePath);
      }
    }

    // Clear game state and undo history
    this.state = null;
    this.stateHistory = [];

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
  }

  private handleReseed(ws: WebSocket): void {
    if (!this.state) return;
    const newSeed = Date.now() ^ Math.floor(Math.random() * 0x7fffffff);
    this.state = { ...this.state, rng: createRng(newSeed) };
    this.broadcastStateWithLogs();
    this.send(ws, { type: 'info', message: 'RNG re-seeded.' });
  }

  private handleCheatRoll(ws: WebSocket, total: number): void {
    if (!this.state) return;
    if (total < 2 || total > 12) {
      this.send(ws, { type: 'error', message: 'Cheat roll total must be between 2 and 12' });
      return;
    }
    this.state = { ...this.state, cheatRollTotal: total };
    this.broadcastToAll({ type: 'info', message: `CHEAT: next roll will be ${total}.` });
  }

  /** Dev-only: create a new instance of any card in the card pool and add it to the player's hand. */
  private handleSummonCard(ws: WebSocket, cardName: string): void {
    if (!this.state) return;

    // Find the requesting player
    let playerId: PlayerId | null = null;
    for (const [, val] of this.players.entries()) {
      if (val.ws === ws) { playerId = val.playerId; break; }
    }
    if (!playerId) {
      this.send(ws, { type: 'error', message: 'Not a registered player' });
      return;
    }

    // Search card pool for a matching definition (case-insensitive, accent-insensitive)
    const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const needle = normalize(cardName);
    let matchDefId: string | null = null;
    let matchName: string | null = null;
    for (const [defId, def] of Object.entries(this.cardPool)) {
      if (normalize((def as { name?: string }).name ?? '') === needle) {
        matchDefId = defId;
        matchName = (def as { name?: string }).name ?? defId;
        break;
      }
    }
    if (!matchDefId) {
      this.send(ws, { type: 'error', message: `No card found matching "${cardName}"` });
      return;
    }

    // Find the highest existing instance counter to avoid ID collisions
    let maxCounter = 0;
    for (const key of Object.keys(this.state.instanceMap)) {
      const match = /^i-(\d+)$/.exec(key);
      if (match) maxCounter = Math.max(maxCounter, parseInt(match[1], 10));
    }
    const newInstanceId = `i-${maxCounter + 1}` as CardInstanceId;
    const definitionId = matchDefId as CardDefinitionId;

    // Add to instance map and player's hand
    const playerIdx = this.state.players.findIndex(p => p.id === playerId);
    if (playerIdx < 0) return;

    const newInstanceMap = {
      ...this.state.instanceMap,
      [newInstanceId as string]: { instanceId: newInstanceId, definitionId },
    };

    const updatedPlayers = this.state.players.map((p, i) =>
      i === playerIdx ? { ...p, hand: [...p.hand, newInstanceId] } : p,
    ) as unknown as readonly [PlayerState, PlayerState];

    this.state = { ...this.state, instanceMap: newInstanceMap, players: updatedPlayers };

    this.broadcastStateWithLogs();
    this.broadcastToAll({ type: 'info', message: `CHEAT: summoned ${matchName}.` });
  }

  // ---- Disconnect / Save / Restore ----

  private handleDisconnect(ws: WebSocket): void {
    const who = this.identifyWs(ws);
    this.serverLog.log('disconnect', { who });

    if (this.spectators.delete(ws)) {
      return;
    }

    // Remove from pending
    for (const [name, p] of this.pending.entries()) {
      if (p.ws === ws) {
        this.pending.delete(name);
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

    if (this.state) {
      this.writeSave(this.autosaveFilePath());
    }

    // Remove the disconnected player but keep the game alive for reconnection
    this.players.delete(disconnectedId);
    this.serverLog.log('player-disconnected', { name: disconnectedName, keepAlive: this.state !== null });
  }

  /**
   * Record the game result to the player's history file at
   * `~/.meccg/players/<name>/games.json`.
   */
  private recordGameResult(playerId: PlayerId): void {
    if (!this.state || this.state.phaseState.phase !== Phase.GameOver) return;

    const goState = this.state.phaseState;
    const playerIndex = this.state.players.findIndex(p => p.id === playerId);
    if (playerIndex < 0) return;

    const player = this.state.players[playerIndex];
    const opponent = this.state.players[1 - playerIndex];
    const playerName = player.name;
    const normalizedName = playerName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // Decode start time from gameId (base-36 timestamp prefix)
    const gameId = this.state.gameId;
    const tsBase36 = gameId.split('-')[0];
    const startedAt = new Date(parseInt(tsBase36, 36)).toISOString();
    const endedAt = new Date().toISOString();

    // Tournament-adjusted breakdown
    const selfRaw = player.marshallingPoints;
    const oppRaw = opponent.marshallingPoints;
    const selfAdj = computeTournamentBreakdown(selfRaw, oppRaw);

    const entry = {
      gameId,
      startedAt,
      endedAt,
      opponent: opponent.name,
      winner: goState.winner === null ? null
        : goState.winner === playerId ? playerName : opponent.name,
      finalScore: goState.finalScores[playerId as string],
      opponentScore: goState.finalScores[opponent.id as string],
      raw: selfRaw,
      adjusted: selfAdj,
    };

    const dir = path.join(PLAYERS_DIR, normalizedName);
    const filePath = path.join(dir, 'games.json');

    try {
      fs.mkdirSync(dir, { recursive: true });
      let games: unknown[] = [];
      try {
        const existing = fs.readFileSync(filePath, 'utf-8');
        games = JSON.parse(existing) as unknown[];
      } catch {
        // File doesn't exist yet
      }
      games.push(entry);
      fs.writeFileSync(filePath, JSON.stringify(games, null, 2) + '\n');
      this.serverLog.log('game-recorded', { player: playerName, gameId });
    } catch (err) {
      this.serverLog.log('game-record-error', { player: playerName, error: String(err) });
    }
  }

  private saveFilePath(): string {
    const names = [...this.playerNames].sort();
    const key = names.join('_vs_');
    return path.join(SAVE_DIR, `${key}.json`);
  }

  private autosaveFilePath(): string {
    const names = [...this.playerNames].sort();
    const key = names.join('_vs_');
    return path.join(SAVE_DIR, `${key}-autosave.json`);
  }

  private writeSave(savePath: string): void {
    if (!this.state) return;

    const save: GameSave = {
      state: this.state,
      nameToPlayerId: this.nameToPlayerId,
    };

    fs.writeFileSync(savePath, JSON.stringify(save), 'utf-8');
    this.serverLog.log('save', { path: savePath, stateSeq: this.state.stateSeq });
  }

  private handleLoad(): void {
    this.serverLog.log('load');
    const savePath = this.saveFilePath();
    if (!fs.existsSync(savePath)) {
      return;
    }
    // Copy manual save to autosave path so restoreGame picks it up on reconnect
    fs.copyFileSync(savePath, this.autosaveFilePath());

    // Clear state, undo history, and restart all clients so they reconnect and load the save
    this.state = null;
    this.stateHistory = [];
    const restartMsg: ServerMessage = { type: 'restart', message: 'Loading saved game. Reconnecting...' };
    for (const [, { ws }] of this.pending.entries()) { this.send(ws, restartMsg); ws.close(); }
    this.pending.clear();
    for (const [, { ws }] of this.players.entries()) { this.send(ws, restartMsg); ws.close(); }
    this.players.clear();
    for (const ws of this.spectators) { this.send(ws, restartMsg); ws.close(); }
    this.spectators.clear();
    this.nameToPlayerId = {};
  }

  /** Dev-only: load a bundled snapshot file as the current save and restart all clients. */
  private handleLoadSnapshot(ws: WebSocket, file: string): void {
    // Validate filename: exactly 3 digits + .json extension
    if (!/^\d{3}\.json$/.test(file)) {
      this.send(ws, { type: 'error', message: `Invalid snapshot filename: "${file}"` });
      return;
    }
    const snapshotPath = path.join(SNAPSHOT_DIR, file);
    if (!fs.existsSync(snapshotPath)) {
      this.send(ws, { type: 'error', message: `Snapshot not found: "${file}"` });
      return;
    }

    // Remap snapshot's player names to match the current game's player names,
    // so loadSave can find the players when clients reconnect.
    const autosavePath = this.autosaveFilePath();
    const snapData = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as GameSave;
    const snapNames = Object.keys(snapData.nameToPlayerId);
    const currentNames = [...this.playerNames];
    if (snapNames.length === 2 && currentNames.length === 2) {
      const remapped: Record<string, string> = {};
      remapped[currentNames[0]] = snapData.nameToPlayerId[snapNames[0]];
      remapped[currentNames[1]] = snapData.nameToPlayerId[snapNames[1]];
      snapData.nameToPlayerId = remapped;
      fs.writeFileSync(autosavePath, JSON.stringify(snapData));
    } else {
      fs.copyFileSync(snapshotPath, autosavePath);
    }
    this.serverLog.log('load-snapshot', { file, savePath: autosavePath });

    // Clear state and restart all clients (same pattern as handleLoad)
    this.state = null;
    this.stateHistory = [];
    const restartMsg: ServerMessage = { type: 'restart', message: 'Loading snapshot. Reconnecting...' };
    for (const [, { ws: pws }] of this.pending.entries()) { this.send(pws, restartMsg); pws.close(); }
    this.pending.clear();
    for (const [, { ws: pws }] of this.players.entries()) { this.send(pws, restartMsg); pws.close(); }
    this.players.clear();
    for (const sws of this.spectators) { this.send(sws, restartMsg); sws.close(); }
    this.spectators.clear();
    this.nameToPlayerId = {};
  }

  private loadSave(name1: string, name2: string): GameSave | null {
    // Try autosave first (most recent state), then manual save
    for (const savePath of [this.autosaveFilePath(), this.saveFilePath()]) {
      if (!fs.existsSync(savePath)) continue;

      try {
        const data = fs.readFileSync(savePath, 'utf-8');
        const save = JSON.parse(data) as GameSave;

        if (!(name1 in save.nameToPlayerId) || !(name2 in save.nameToPlayerId)) {
          continue;
        }

        save.state = { ...save.state, cardPool: this.cardPool };
        fs.unlinkSync(savePath);

        return save;
      } catch {
        continue;
      }
    }
    return null;
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

  /**
   * Broadcast state to all clients, capturing engine log output and
   * forwarding it to clients as a LogMessage when in dev mode.
   */
  private broadcastStateWithLogs(): void {
    if (this.dev) startCapture();
    this.broadcastState();
    if (this.dev) {
      const lines = flushCapture();
      if (lines.length > 0) {
        this.broadcastToAll({ type: 'log', lines });
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
      // Log outgoing messages (skip 'state' — logged separately as snapshots)
      if (msg.type !== 'state') {
        this.serverLog.log('msg-out', { msgType: msg.type, to: this.identifyWs(ws), msg });
      }
      ws.send(json);
    }
  }
}
