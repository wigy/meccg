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
  StateMessage,
  ActionMessage,
} from '@meccg/shared';
import { loadCardPool, createRng, buildMovementMap, createGame, reduce, startCapture, flushCapture, Phase, computeTournamentBreakdown, computeLegalActions, canonicalActionKey, extractActionCardDefs, validateDeck, Alignment, CHARACTER_CARD_TYPES } from '@meccg/shared';
import type { MovementMap, PlayerConfig, GameConfig, DeckList, DeckListEntry } from '@meccg/shared';
import { TUTORIAL_HERO_DECK, TUTORIAL_MENTOR_DECK } from '@meccg/shared';
import { projectPlayerView, projectSpectatorView } from './projection.js';
import { TutorialController } from './tutorial-controller.js';
import { ServerLog, GameLog } from './game-log.js';
import { buildCompletedGameRecord, writeCompletedGameRecord, GAME_RECORDS_DIR } from './game-record.js';
import type { PlayerDeckInfo } from './game-record.js';

const SAVE_DIR = process.env.SAVE_DIR ?? path.join(os.homedir(), '.meccg', 'saves');
const PLAYERS_DIR = path.join(os.homedir(), '.meccg', 'players');

/** Deck-editor alignment key for each card alignment, for rebuilding a DeckList. */
const DECK_ALIGNMENTS: Record<Alignment, DeckList['alignment']> = {
  [Alignment.Wizard]: 'hero',
  [Alignment.Ringwraith]: 'minion',
  [Alignment.FallenWizard]: 'fallen-wizard',
  [Alignment.Balrog]: 'balrog',
};

/** Collapse a flat list of card definition IDs into deck-list entries with quantities. */
function toDeckEntries(
  ids: readonly CardDefinitionId[],
  cardPool: Readonly<Record<string, CardDefinition>>,
): DeckListEntry[] {
  const counts = new Map<CardDefinitionId, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([card, qty]) => ({ name: cardPool[card]?.name ?? String(card), card, qty }));
}

/**
 * Rebuild a deck-editor DeckList from a join message so the shared deck
 * validator can run server-side. The join message carries the play deck as
 * one flat list, so it is split back into characters, hazards, and
 * resources by card type.
 */
function joinToDeckList(
  join: JoinMessage,
  name: string,
  cardPool: Readonly<Record<string, CardDefinition>>,
): DeckList {
  const characters: CardDefinitionId[] = [];
  const hazards: CardDefinitionId[] = [];
  const resources: CardDefinitionId[] = [];
  for (const id of join.playDeck) {
    const cardType = cardPool[id]?.cardType ?? '';
    if (CHARACTER_CARD_TYPES.has(cardType)) characters.push(id);
    else if (cardType.startsWith('hazard')) hazards.push(id);
    else resources.push(id);
  }
  return {
    id: `${name}-joined`,
    name: `${name}'s deck`,
    alignment: DECK_ALIGNMENTS[join.alignment],
    pool: toDeckEntries(join.draftPool, cardPool),
    deck: {
      characters: toDeckEntries(characters, cardPool),
      hazards: toDeckEntries(hazards, cardPool),
      resources: toDeckEntries(resources, cardPool),
    },
    sites: toDeckEntries(join.siteDeck, cardPool),
    sideboard: toDeckEntries(join.sideboard, cardPool),
    antiFwSideboard: toDeckEntries(join.antiFwSideboard ?? [], cardPool),
  };
}

interface PendingPlayer {
  ws: WebSocket;
  join: JoinMessage;
}

interface GameSave {
  state: GameState;
  nameToPlayerId: Record<string, string>;
  /** Deck identity per lowercase player name; absent in saves from old code. */
  deckInfo?: Record<string, PlayerDeckInfo>;
  /** Lowercase names of AI-controlled seats; absent in saves from old code. */
  aiPlayers?: string[];
}

/**
 * How long the session tolerates having no human player connected before
 * reporting itself idle. Long enough to ride out a page reload or the
 * client's reconnect attempts; short enough that a quit game does not
 * linger as "in progress" in the lobby. A longer absence is not lost:
 * an autosave is written on disconnect, and the lobby's rejoin flow
 * relaunches from it.
 */
export const IDLE_EXIT_GRACE_MS = 60_000;

export interface GameSessionOptions {
  /** Enable development-mode operations (undo, save, load, reseed). */
  dev?: boolean;
  /**
   * Run the guided tutorial (specs/2026-07-30-tutorial-plan.md): both decks
   * come from the shared tutorial module (joined decks are ignored), the
   * game is created with ordered decks and a fixed seed, the second named
   * player ("Mentor") is played server-side by the TutorialController, and
   * the human's legal actions are gated to the current script beat.
   */
  tutorial?: boolean;
  playerNames: [string, string];
  /**
   * Called once no human player has been connected for
   * {@link IDLE_EXIT_GRACE_MS} — including when none ever joined. The server
   * entry uses this to exit the process, which is what tells the lobby the
   * game is over (it clears busy status and the watchable-game row on child
   * exit). An AI seat or spectators alone never keep a session alive.
   */
  onIdle?: () => void;
}

/**
 * A single game between two fixed players. Anyone else connecting is
 * a spectator. On disconnect, the game is saved and can be resumed
 * when the same players reconnect.
 */
export class GameSession {
  private state: GameState | null = null;
  private players: Map<string, { ws: WebSocket; playerId: PlayerId; name: string }> = new Map();
  /** Spectator connections, each mapped to the display name it joined with. */
  private spectators: Map<WebSocket, string> = new Map();
  private pending: Map<string, PendingPlayer> = new Map();
  private cardPool: Readonly<Record<string, CardDefinition>>;
  private nameToPlayerId: Record<string, string> = {};
  /** Deck identity per lowercase player name, captured from join messages. */
  private deckInfo: Record<string, PlayerDeckInfo> = {};
  /** Lowercase names of AI-controlled seats, captured from join messages. */
  private aiPlayers: Set<string> = new Set();
  private playerCounter = 0;
  /** When false, dev-only operations (undo, save, load, reseed, reset) are refused. */
  private dev: boolean;
  /** Non-null while running the guided tutorial: script cursor, gating, Mentor seat. */
  private tutorial: TutorialController | null = null;
  /** Set at construction when this session is a tutorial game. */
  private tutorialMode: boolean;
  private playerNames: Set<string>;
  private serverLog: ServerLog;
  private gameLog: GameLog;
  /** History of previous states for undo support. */
  private stateHistory: GameState[] = [];
  /** Precomputed movement map for region/starter movement queries. */
  private movementMap: MovementMap;
  /**
   * Per-player snapshot of the viable legal actions most recently sent to
   * each client, keyed by canonical actionId. Incoming actions are
   * validated by membership lookup in this map — anything not in the set
   * the player was offered is rejected as stale or illegal.
   */
  private lastLegalActionsPerPlayer: Map<PlayerId, Map<string, GameAction>> = new Map();
  /** Armed while no human is connected; fires `onIdle` after the grace period. */
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onIdle?: () => void;

  constructor(options: GameSessionOptions) {
    this.dev = options.dev ?? false;
    this.tutorialMode = options.tutorial ?? false;
    this.playerNames = new Set(options.playerNames.map(n => n.toLowerCase()));
    this.onIdle = options.onIdle;
    this.cardPool = loadCardPool();
    this.movementMap = buildMovementMap(this.cardPool);
    fs.mkdirSync(SAVE_DIR, { recursive: true });
    this.serverLog = new ServerLog();
    this.gameLog = new GameLog();
    this.serverLog.log('boot', { players: options.playerNames, dev: this.dev });
    // The grace clock starts at boot: a server whose players never join must
    // not outlive the grace period either.
    this.updateIdleTimer();
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
    // Tutorial games are never saved: the script cursor lives only in this
    // process, so a restored save could not be continued on rails.
    if (this.state && !this.isFullyFinished() && !this.tutorialMode) {
      this.writeSave(this.autosaveFilePath());
    }

    this.disconnectAll({ type: 'restart', message: 'Server restarting. Reconnecting...' });

    this.state = null;
    this.serverLog.close();
    this.gameLog.close();
  }

  /**
   * Send `msg` to every connection (pending, players, spectators), close
   * them all, and clear the connection registries. Used when the session
   * restarts (shutdown, loading a save) and clients must reconnect.
   */
  private disconnectAll(msg: ServerMessage): void {
    for (const [, { ws }] of this.pending.entries()) {
      this.send(ws, msg);
      ws.close();
    }
    this.pending.clear();

    for (const [, { ws }] of this.players.entries()) {
      this.send(ws, msg);
      ws.close();
    }
    this.players.clear();

    for (const ws of this.spectators.keys()) {
      this.send(ws, msg);
      ws.close();
    }
    this.spectators.clear();
  }

  private handleMessage(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case 'join':
        this.handleJoin(ws, msg);
        this.updateIdleTimer();
        break;
      case 'action':
        this.handleAction(ws, msg);
        break;
      case 'save':
      case 'load':
      case 'reseed':
      case 'undo':
      case 'cheat-roll':
      case 'summon-card':
      case 'swap-hand':
        if (this.tutorialMode) {
          // The script owns the dice and the state; any of these would
          // desynchronize the tutorial cursor.
          this.send(ws, { type: 'error', message: `'${msg.type}' is not available in the tutorial` });
          break;
        }
        if (!this.dev) {
          this.send(ws, { type: 'error', message: `'${msg.type}' is only available in development mode (--dev)` });
          break;
        }
        // Any dev command taints the game: mark before handling so a 'save'
        // persists the flag, and again after because 'undo'/'load' replace
        // the current state with one from before the marking.
        {
          const wasCheated = this.state?.cheated === true;
          this.markCheated(msg.type);
          if (msg.type === 'save') { this.writeSave(this.saveFilePath()); this.send(ws, { type: 'info', message: 'Game saved.' }); }
          else if (msg.type === 'load') this.handleLoad();
          else if (msg.type === 'reseed') this.handleReseed(ws);
          else if (msg.type === 'undo') this.handleUndo(ws);
          else if (msg.type === 'cheat-roll') this.handleCheatRoll(ws, msg.total);
          else if (msg.type === 'summon-card') this.handleSummonCard(ws, msg.cardName);
          else if (msg.type === 'swap-hand') this.handleSwapHand(ws);
          const restamped = this.markCheated(msg.type);
          // Make sure every client sees the flag flip: some dev commands
          // never broadcast state ('save', 'cheat-roll'), and 'undo'/'load'
          // broadcast the restored — possibly pre-cheat — state before the
          // re-stamp above.
          if (this.state && (!wasCheated || restamped)) this.broadcastStateWithLogs();
        }
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
        this.broadcastSpectators();
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
        this.broadcastSpectators();
        this.broadcastState();
        return;
      }
    }

    this.pending.set(normalizedName, { ws, join: msg });
    this.serverLog.log('join', { name: msg.name, role: 'player' });

    // Tutorial: the Mentor seat is played server-side and never connects —
    // start as soon as the human joins. The joined deck is ignored; both
    // decks come from the shared tutorial module.
    if (this.tutorialMode) {
      this.startTutorialGame(this.pending.get(normalizedName)!, msg.name);
      return;
    }

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
    this.spectators.set(ws, name);
    this.serverLog.log('join', { name, role: 'spectator' });
    this.send(ws, { type: 'assigned', playerId: 'spectator' as PlayerId, gameId: this.state?.gameId ?? 'unknown' });

    if (this.state) {
      const view = projectSpectatorView(this.state);
      this.send(ws, { type: 'state', view });
    }
    this.broadcastSpectators();
  }

  /**
   * Tell everyone who is currently watching. Called whenever the spectator
   * set changes and whenever a client is seated, since a spectator arriving
   * or leaving does not change the game state and so never reaches the state
   * broadcast. Duplicate names collapse: one person watching from two tabs
   * is one watcher.
   */
  private broadcastSpectators(): void {
    const names = [...new Set(this.spectators.values())].sort();
    this.broadcastToAll({ type: 'spectators', names });
  }

  /**
   * Start the guided tutorial: fixed decks and seed, ordered draws, the
   * human in seat 0 and the server-driven Mentor in seat 1.
   */
  private startTutorialGame(p: PendingPlayer, humanName: string): void {
    const humanId = `p${++this.playerCounter}` as PlayerId;
    const mentorId = `p${++this.playerCounter}` as PlayerId;
    const mentorName = 'Mentor';

    this.nameToPlayerId = {
      [humanName.toLowerCase()]: humanId as string,
      [mentorName.toLowerCase()]: mentorId as string,
    };

    const config: GameConfig = {
      players: [
        { id: humanId, name: humanName, ...TUTORIAL_HERO_DECK },
        { id: mentorId, name: mentorName, ...TUTORIAL_MENTOR_DECK },
      ],
      // The script's cheat rolls force every outcome; the seed only shapes
      // the cosmetic die splits. Fixed so replays match the tutorial test.
      seed: 7,
      orderedDecks: true,
    };

    this.state = createGame(config, this.cardPool);
    this.tutorial = new TutorialController(humanId, mentorId);
    this.state = this.tutorial.armCheat(this.state);

    this.players.set(humanId as string, { ws: p.ws, playerId: humanId, name: humanName });
    this.pending.clear();
    this.send(p.ws, { type: 'assigned', playerId: humanId, gameId: this.state.gameId });
    this.broadcastSpectators();

    this.serverLog.log('new-game', { gameId: this.state.gameId, player1: humanName, player2: mentorName, tutorial: true });
    this.gameLog.open(this.state.gameId);
    this.gameLog.writeStaticData(
      this.state.cardPool as unknown as Record<string, unknown>,
      this.state,
    );
    this.logState('new-game');
    this.broadcastStateWithLogs();
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
    this.captureDeckInfo(p1, name1);
    this.captureDeckInfo(p2, name2);
    this.registerPlayers(p1, p1Id, name1, p2, p2Id, name2);

    this.serverLog.log('new-game', { gameId: this.state.gameId, player1: name1, player2: name2 });
    this.gameLog.open(this.state.gameId);
    this.gameLog.writeStaticData(
      this.state.cardPool as unknown as Record<string, unknown>,
      this.state,
    );
    this.logState('new-game');

    this.broadcastStateWithLogs();

    this.announceDeckLegality(p1.join, name1);
    this.announceDeckLegality(p2.join, name2);
  }

  /**
   * Remember a player's deck identity for the completed-game record. Only
   * the structured deck list carries it — reconstructed decks (pseudo-AI,
   * minimal reconnect joins) have no catalog identity, so absent fields
   * stay null rather than guessing.
   */
  private captureDeckInfo(p: PendingPlayer, name: string): void {
    const deckList = p.join.deckList;
    this.deckInfo[name.toLowerCase()] = {
      id: deckList?.id ?? null,
      name: deckList?.name ?? null,
      gameLength: deckList?.gameLength ?? null,
    };
    this.captureAiFlag(p, name);
  }

  /**
   * Remember whether this seat is AI-controlled. Clients that predate the
   * join-message `ai` field fall back to the lobby's `AI-` naming
   * convention (AI-MC, AI-Real, AI-Heuristic, AI-Pseudo).
   */
  private captureAiFlag(p: PendingPlayer, name: string): void {
    if (p.join.ai ?? /^ai-/i.test(name)) {
      this.aiPlayers.add(name.toLowerCase());
    }
  }

  /**
   * Check a player's deck against the deck-construction rules and announce
   * the verdict to everyone: green for a legal deck, red otherwise.
   */
  private announceDeckLegality(join: JoinMessage, name: string): void {
    // Prefer the structured deck list the editor validated (join.deckList) so
    // the server reaches the same verdict on the same input. Only fall back to
    // reconstructing the deck from the flat card lists (joinToDeckList) for
    // clients that don't send it — the pseudo-AI and minimal reconnect joins.
    // That reconstruction re-buckets the play deck by cardType and can mis-file
    // character-typed hazards (agents, Nazgûl played as creatures), producing a
    // verdict that disagrees with the deck editor.
    const deckList = join.deckList ?? joinToDeckList(join, name, this.cardPool);
    const errors = validateDeck(deckList, this.cardPool);
    this.serverLog.log('deck-validation', {
      player: name,
      errors: errors.length,
      messages: errors.map(e => `${e.section}: ${e.message}`),
    });
    this.broadcastToAll(errors.length === 0
      ? { type: 'info', message: `${name} deck is legal`, tone: 'success' }
      : { type: 'info', message: `${name} deck is not legal`, tone: 'error' });
  }

  private restoreGame(save: GameSave, p1: PendingPlayer, p2: PendingPlayer, name1: string, name2: string): void {
    this.state = {
      ...save.state,
      chain: save.state.chain ?? null,
      combat: save.state.combat ?? null,
      players: save.state.players.map(p => ({ ...p, agents: p.agents ?? [] })) as unknown as typeof save.state.players,
    };
    // Normalize saved name-to-ID map to lowercase keys
    const normalizedMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(save.nameToPlayerId)) {
      normalizedMap[k.toLowerCase()] = v;
    }
    this.nameToPlayerId = normalizedMap;
    this.deckInfo = { ...(save.deckInfo ?? {}) };
    this.aiPlayers = new Set(save.aiPlayers ?? []);
    // Saves from before deckInfo existed have no deck identity; a reconnect
    // join that still carries the structured deck list can fill the gap.
    // The AI flag rides every join (even minimal rejoins), so recapture it.
    for (const [pending, name] of [[p1, name1], [p2, name2]] as const) {
      this.captureAiFlag(pending, name);
      if (this.deckInfo[name.toLowerCase()]?.id == null && pending.join.deckList) {
        this.captureDeckInfo(pending, name);
      }
    }

    const p1Id = normalizedMap[name1.toLowerCase()] as PlayerId;
    const p2Id = normalizedMap[name2.toLowerCase()] as PlayerId;

    this.registerPlayers(p1, p1Id, name1, p2, p2Id, name2);

    this.serverLog.log('restore', { gameId: this.state.gameId, stateSeq: this.state.stateSeq, player1: name1, player2: name2 });

    // A crash between reaching game over and clients finishing can leave a
    // finished game behind as a save; catch up on the missing record.
    if (this.state.phaseState.phase === Phase.GameOver
        && !fs.existsSync(path.join(GAME_RECORDS_DIR, `${this.state.gameId}.json`))) {
      this.recordCompletedGame();
    }
    this.gameLog.open(this.state.gameId);
    this.gameLog.writeStaticData(
      this.state.cardPool as unknown as Record<string, unknown>,
      this.state,
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
    this.broadcastSpectators();
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
      antiFwSideboard: p.join.antiFwSideboard,
    };
  }

  private handleAction(ws: WebSocket, msg: ActionMessage): void {
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

    // Membership check against the legal-action set we last sent this
    // player. Derive the lookup key from the echoed actionId when the
    // client provides one, else re-canonicalize the submitted action.
    // The stored action is the one we actually dispatch — client-supplied
    // fields are never trusted past this lookup.
    const candidate: GameAction = { ...msg.action, player: playerId };
    const key = msg.actionId ?? canonicalActionKey(candidate);
    const legalSet = this.lastLegalActionsPerPlayer.get(playerId);
    const stored = legalSet?.get(key);
    if (!stored) {
      this.serverLog.log('action-rejected', { reason: 'not-in-legal-set', action: candidate, key });
      this.send(ws, { type: 'error', message: 'Action is not in the current legal action set' });
      return;
    }
    const actionWithPlayer = stored;

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
    const wasGameOver = this.state.phaseState.phase === Phase.GameOver;
    if (this.tutorial) this.tutorial.noteApplied(this.state, actionWithPlayer, playerId);
    this.stateHistory.push(this.state);
    this.state = result.state;
    this.serverLog.log('action', { action: actionWithPlayer });
    this.logState(actionWithPlayer.type, actionWithPlayer as unknown as Record<string, unknown>);

    // The game just ended: persist the completed-game record now, while both
    // clients may still walk away without ever sending 'finished'.
    if (!wasGameOver && this.state.phaseState.phase === Phase.GameOver) {
      this.recordCompletedGame();
    }

    // When a player sends 'finished', record the game result to their history file
    if (actionWithPlayer.type === 'finished') {
      this.recordGameResult(playerId);
      this.deleteSavesIfAllFinished();
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
        const def0 = pick0 !== null ? pick0.definitionId : null;
        const def1 = pick1 !== null ? pick1.definitionId : null;
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
    this.broadcastState(actionWithPlayer);

    // Flush all captured log lines (from reduce + broadcastState) to clients
    if (this.dev) {
      const lines = flushCapture();
      if (lines.length > 0) {
        this.broadcastToAll({ type: 'log', lines });
      }
    }

    this.runTutorialMentor();
  }

  /**
   * Play the Mentor's scripted beats (and chain-priority passes) until the
   * script waits on the human again. Each Mentor action is applied and
   * broadcast individually so the player watches the Mentor "move". Finally
   * arms the scripted dice for the human's next beat.
   */
  private runTutorialMentor(): void {
    if (!this.tutorial || !this.state) return;

    for (let guard = 0; guard < 64; guard++) {
      this.state = this.tutorial.armCheat(this.state);
      const action = this.tutorial.mentorAction(this.state);
      if (!action) break;

      const result = reduce(this.state, action);
      if (result.error) {
        // A script/engine divergence — a tutorial bug, never a user error.
        this.serverLog.log('tutorial-mentor-error', { action, error: result.error });
        break;
      }

      const wasGameOver = this.state.phaseState.phase === Phase.GameOver;
      this.tutorial.noteApplied(this.state, action, this.tutorial.mentorId);
      this.stateHistory.push(this.state);
      this.state = result.state;
      this.serverLog.log('action', { action, tutorialMentor: true });
      this.logState(action.type, action as unknown as Record<string, unknown>);
      if (!wasGameOver && this.state.phaseState.phase === Phase.GameOver) {
        this.recordCompletedGame();
      }

      if (result.effects && result.effects.length > 0) {
        for (const effect of result.effects) {
          this.broadcastToAll({ type: 'effect', effect });
        }
      }
      this.broadcastStateWithLogs(action);
    }

    // The dice for the human's next scripted roll must be armed before the
    // human acts on the freshly broadcast legal actions.
    const armed = this.tutorial.armCheat(this.state);
    if (armed !== this.state) {
      this.state = armed;
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
      const { cardPool: _cardPool, ...stateWithoutStatic } = this.state;
      // Compute legal actions for both players and include in the log
      const legalActions: Record<string, unknown[]> = {};
      for (const player of this.state.players) {
        const evaluated = computeLegalActions(this.state, player.id);
        legalActions[player.id as string] = evaluated.map(e =>
          e.viable
            ? { action: e.action }
            : { action: e.action, reason: e.reason },
        );
      }
      this.gameLog.log('state', {
        stateSeq: this.state.stateSeq,
        reason,
        ...(action ? { action } : {}),
        turn: this.state.turnNumber,
        phase: this.state.phaseState.phase,
        step: this.state.phaseState.phase === 'setup' ? this.state.phaseState.setupStep.step : null,
        activePlayer: this.state.activePlayer,
        legalActions,
        state: stateWithoutStatic,
      });
    }
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

    // Find the player whose hand will receive the summoned card. The minted
    // instance ID is prefixed with this player's PlayerId so ownerOf() can
    // attribute it correctly (the summoning player is the owner).
    const playerIdx = this.state.players.findIndex(p => p.id === playerId);
    if (playerIdx < 0) return;
    const summoningPlayer = this.state.players[playerIdx];

    // Scan all of the summoning player's card locations (piles, characters in
    // companies, characters dict, and agents) to find the next free counter.
    // Omitting any location risks generating an ID that collides with a card
    // already in play (e.g. a wizard character in a company would be missed
    // if only flat piles are scanned).
    const prefix = summoningPlayer.id as string;
    const counterRe = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
    let maxCounter = 0;
    const countId = (id: CardInstanceId) => {
      const m = counterRe.exec(id as string);
      if (m) maxCounter = Math.max(maxCounter, parseInt(m[1], 10));
    };
    const countInstances = (pile: readonly { instanceId: CardInstanceId }[]) => {
      for (const card of pile) countId(card.instanceId);
    };
    countInstances(summoningPlayer.hand);
    countInstances(summoningPlayer.playDeck);
    countInstances(summoningPlayer.discardPile);
    countInstances(summoningPlayer.siteDeck);
    countInstances(summoningPlayer.siteDiscardPile);
    countInstances(summoningPlayer.sideboard);
    countInstances(summoningPlayer.killPile);
    countInstances(summoningPlayer.outOfPlayPile);
    // Also scan characters in companies, the characters dict, and agents —
    // these are not in flat piles but carry instance IDs that must not collide.
    for (const company of summoningPlayer.companies) {
      for (const charId of company.characters) countId(charId);
    }
    for (const charId of Object.keys(summoningPlayer.characters)) countId(charId as CardInstanceId);
    for (const agent of summoningPlayer.agents) countId(agent.character.instanceId);
    const newInstanceId = `${prefix}-${maxCounter + 1}` as CardInstanceId;
    const definitionId = matchDefId as CardDefinitionId;

    const newCard = { instanceId: newInstanceId, definitionId };

    const updatedPlayers = this.state.players.map((p, i) =>
      i === playerIdx ? { ...p, hand: [...p.hand, newCard] } : p,
    ) as unknown as readonly [PlayerState, PlayerState];

    this.state = { ...this.state, players: updatedPlayers };

    this.broadcastStateWithLogs();
    this.broadcastToAll({ type: 'info', message: `CHEAT: summoned ${matchName}.` });
  }

  // ---- Disconnect / Save / Restore ----

  private handleDisconnect(ws: WebSocket): void {
    const who = this.identifyWs(ws);
    this.serverLog.log('disconnect', { who });

    if (this.spectators.delete(ws)) {
      this.broadcastSpectators();
      return;
    }

    // Remove from pending
    for (const [name, p] of this.pending.entries()) {
      if (p.ws === ws) {
        this.pending.delete(name);
        this.updateIdleTimer();
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

    if (this.state && !this.isFullyFinished() && !this.tutorialMode) {
      this.writeSave(this.autosaveFilePath());
    }

    // Remove the disconnected player but keep the game alive for reconnection
    this.players.delete(disconnectedId);
    this.serverLog.log('player-disconnected', { name: disconnectedName, keepAlive: this.state !== null });
    this.updateIdleTimer();
  }

  /** Whether any connected player or pending join is a human. */
  private hasConnectedHuman(): boolean {
    for (const { name } of this.players.values()) {
      if (!this.aiPlayers.has(name.toLowerCase()) && !/^ai-/i.test(name)) return true;
    }
    for (const [name, p] of this.pending.entries()) {
      if (!(p.join.ai ?? /^ai-/i.test(name))) return true;
    }
    return false;
  }

  /**
   * Arm the idle timer while no human is connected, disarm it when one is.
   * The timer re-checks before firing, so a human who reconnected and
   * disconnected again within one grace period cannot race it.
   */
  private updateIdleTimer(): void {
    if (!this.onIdle) return;
    if (this.hasConnectedHuman()) {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
      return;
    }
    this.idleTimer ??= setTimeout(() => {
      this.idleTimer = null;
      if (!this.hasConnectedHuman()) this.onIdle?.();
    }, IDLE_EXIT_GRACE_MS);
  }

  /**
   * Mark the game as cheated because a developer-tools command was used.
   * A cheated game's end result is never recorded (per-game record or
   * player histories). The flag lives on {@link GameState} so it survives
   * saves and restores; it is never cleared once set.
   *
   * @returns True when the flag was actually flipped by this call.
   */
  private markCheated(command: string): boolean {
    if (!this.state || this.state.cheated) return false;
    this.state = { ...this.state, cheated: true };
    this.serverLog.log('game-cheated', { gameId: this.state.gameId, command });
    return true;
  }

  /**
   * Write the single per-game statistics record to
   * `~/.meccg/games/<gameId>.json`. Failures are logged, never thrown —
   * losing a stats record must not take the session down with it.
   */
  private recordCompletedGame(): void {
    if (!this.state || this.state.phaseState.phase !== Phase.GameOver) return;
    if (this.state.cheated) {
      this.serverLog.log('game-not-recorded-cheated', { gameId: this.state.gameId });
      return;
    }
    try {
      const record = buildCompletedGameRecord(this.state, this.deckInfo, this.aiPlayers, new Date());
      const filePath = writeCompletedGameRecord(record);
      this.serverLog.log('game-completed', { gameId: record.gameId, path: filePath, winner: record.winner });
    } catch (err) {
      this.serverLog.log('game-record-error', { gameId: this.state.gameId, error: String(err) });
    }
  }

  /**
   * Record the game result to the player's history file at
   * `~/.meccg/players/<name>/games.json`.
   */
  private recordGameResult(playerId: PlayerId): void {
    if (!this.state || this.state.phaseState.phase !== Phase.GameOver) return;
    if (this.state.cheated) {
      this.serverLog.log('game-not-recorded-cheated', { gameId: this.state.gameId, playerId });
      return;
    }

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
      finalScore: goState.finalScores[playerId],
      opponentScore: goState.finalScores[opponent.id],
      raw: selfRaw,
      adjusted: selfAdj,
      // How the game was decided (CoE 10.39). Denormalised card/alignment for
      // convenient stats queries; null on a normal marshalling-points win.
      winReason: goState.winReason.kind,
      winCard: goState.winReason.kind === 'one-ring' ? goState.winReason.card : null,
      winAlignment: goState.winReason.kind === 'one-ring' ? goState.winReason.alignment : null,
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

  /**
   * True once the game is over *and* every player has acknowledged the result.
   * At that point the outcome lives in each player's history and the save files
   * have been deleted, so the session must never write them again: rewriting an
   * autosave on shutdown or disconnect resurrects the finished game, and the
   * next game between the same two names restores it and starts in `game-over`
   * with no legal actions for either player.
   */
  private isFullyFinished(): boolean {
    if (!this.state || this.state.phaseState.phase !== Phase.GameOver) return false;
    return this.state.phaseState.finishedPlayers.length >= this.state.players.length;
  }

  /**
   * Delete save and autosave files once all players have acknowledged the
   * game result. At that point the outcome is persisted in each player's
   * history, so the save is no longer needed.
   */
  private deleteSavesIfAllFinished(): void {
    if (!this.isFullyFinished()) return;

    for (const filePath of [this.saveFilePath(), this.autosaveFilePath()]) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          this.serverLog.log('save-deleted', { path: filePath });
        }
      } catch (err) {
        this.serverLog.log('save-delete-error', { path: filePath, error: String(err) });
      }
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
      deckInfo: this.deckInfo,
      aiPlayers: [...this.aiPlayers],
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
    this.disconnectAll({ type: 'restart', message: 'Loading saved game. Reconnecting...' });
    this.nameToPlayerId = {};
  }

  /** Dev-only: load a bundled snapshot file as the current save and restart all clients. */
  private handleSwapHand(ws: WebSocket): void {
    if (!this.state) return;

    const p0 = this.state.players[0];
    const p1 = this.state.players[1];
    const newPlayers: [typeof p0, typeof p1] = [
      { ...p0, hand: p1.hand },
      { ...p1, hand: p0.hand },
    ];
    this.state = { ...this.state, players: newPlayers };

    console.log(`[swap-hand] Swapped hands: ${p0.name} (${p0.hand.length} cards) ↔ ${p1.name} (${p1.hand.length} cards)`);
    this.send(ws, { type: 'info', message: `Hands swapped: ${p0.name} ↔ ${p1.name}` });
    this.broadcastState();
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

        // A save of an already-acknowledged game is dead weight: restoring it
        // would seat both players in `game-over` with no legal actions, so the
        // new game could never start. Drop it and fall through to a fresh game.
        const phaseState = save.state.phaseState;
        if (phaseState.phase === Phase.GameOver
          && phaseState.finishedPlayers.length >= save.state.players.length) {
          fs.unlinkSync(savePath);
          this.serverLog.log('save-discarded-finished', { path: savePath });
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

  private broadcastState(lastAction?: GameAction): void {
    if (!this.state) return;

    // Identities of cards referenced in lastAction that have become public
    // at some point during the game (see GameState.revealedInstances). The
    // same map is broadcast to every recipient — cards private to the
    // acting player (e.g. a character shuffled into their face-down play
    // deck) are absent from the map and render as "a card" in the
    // audience's toast. The acting player still sees the real name
    // because their own projected view resolves instances in private
    // piles they can see (their hand, their draft pool, etc.).
    const lastActionCardDefs = lastAction ? extractActionCardDefs(this.state, lastAction) : undefined;

    this.lastLegalActionsPerPlayer.clear();
    for (const [, { ws, playerId }] of this.players.entries()) {
      let view = projectPlayerView(this.state, playerId);
      if (this.tutorial && playerId === this.tutorial.humanId) {
        // Gate the human to the current script beat and attach progress.
        // The membership map below is built from the gated list, so
        // off-script actions are rejected server-side too.
        view = {
          ...view,
          legalActions: this.tutorial.gate(this.state, view.legalActions),
          tutorial: this.tutorial.progress(),
        };
      }
      const legalSet = new Map<string, GameAction>();
      for (const ea of view.legalActions) {
        if (!ea.viable || !ea.actionId) continue;
        legalSet.set(ea.actionId, ea.action);
      }
      this.lastLegalActionsPerPlayer.set(playerId, legalSet);
      const msg: StateMessage = lastAction
        ? { type: 'state', view, lastAction, lastActionCardDefs }
        : { type: 'state', view };
      this.send(ws, msg);
    }

    if (this.spectators.size > 0) {
      const spectatorView = projectSpectatorView(this.state);
      for (const ws of this.spectators.keys()) {
        const msg: StateMessage = lastAction
          ? { type: 'state', view: spectatorView, lastAction, lastActionCardDefs }
          : { type: 'state', view: spectatorView };
        this.send(ws, msg);
      }
    }
  }

  /**
   * Broadcast state to all clients, capturing engine log output and
   * forwarding it to clients as a LogMessage when in dev mode.
   */
  private broadcastStateWithLogs(lastAction?: GameAction): void {
    if (this.dev) startCapture();
    this.broadcastState(lastAction);
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
    for (const ws of this.spectators.keys()) {
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
