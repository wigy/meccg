/**
 * @module game-session
 *
 * Manages the lifecycle of a single MECCG game over WebSocket connections.
 *
 * {@link GameSession} acts as the bridge between the transport layer
 * (WebSocket messages) and the pure game engine (reducer). It handles:
 *
 * - **Player registration**: clients send a "join" message with their name,
 *   deck lists, and draft pool. The session queues them until two are present.
 * - **Game creation**: once two players have joined, the game state is
 *   initialised via {@link createGame} and initial state is broadcast.
 * - **Action routing**: incoming "action" messages are enriched with the
 *   sender's player ID, run through the reducer, and — if valid — the
 *   resulting state is projected and broadcast to each player.
 * - **Disconnection cleanup**: departed players are removed from the
 *   pending queue or active roster.
 *
 * The session does not handle reconnection or spectating yet.
 */

import type WebSocket from 'ws';
import type {
  GameState,
  PlayerView,
  PlayerId,
  CardDefinitionId,
  CardDefinition,
  ClientMessage,
  ServerMessage,
  JoinMessage,
  GameAction,
} from '@meccg/shared';
import { formatGameState, loadCardPool } from '@meccg/shared';
import { createGame } from '../engine/init.js';
import type { PlayerConfig, GameConfig } from '../engine/init.js';
import { reduce } from '../engine/reducer.js';
import { projectPlayerView } from './projection.js';

/** A client that has sent a "join" message but is waiting for an opponent. */
interface PendingPlayer {
  ws: WebSocket;
  join: JoinMessage;
  playerId: PlayerId;
}

/**
 * Orchestrates a single two-player MECCG game.
 *
 * Typical flow:
 * 1. Two clients connect and call {@link addConnection}.
 * 2. Each sends a `join` message; the session queues them as pending.
 * 3. When both are ready, {@link startGame} creates the game state.
 * 4. Subsequent `action` messages are processed through the reducer.
 * 5. After each valid action, updated player views are broadcast.
 */
export class GameSession {
  /** The authoritative game state, or `null` before the game starts. */
  private state: GameState | null = null;
  /** Active players keyed by player ID string. */
  private players: Map<string, { ws: WebSocket; playerId: PlayerId }> = new Map();
  /** Clients waiting for an opponent. */
  private pending: PendingPlayer[] = [];
  /** Immutable card definition dictionary, loaded once at construction. */
  private cardPool: Readonly<Record<string, CardDefinition>>;
  /** Monotonic counter for generating unique player IDs ("p1", "p2", ...). */
  private playerCounter = 0;

  constructor() {
    this.cardPool = loadCardPool();
  }

  /**
   * Registers a new WebSocket connection. Sets up message and close
   * handlers. The client is not yet a "player" until it sends a "join"
   * message.
   */
  addConnection(ws: WebSocket): void {
    ws.on('message', (data) => {
      try {
        const msg: ClientMessage = JSON.parse(data.toString());
        this.handleMessage(ws, msg);
      } catch (e) {
        this.send(ws, { type: 'error', message: 'Invalid message format' });
      }
    });

    ws.on('close', () => {
      // Remove from pending or active players
      this.pending = this.pending.filter(p => p.ws !== ws);
      for (const [key, val] of this.players.entries()) {
        if (val.ws === ws) {
          this.players.delete(key);
          console.log(`Player ${val.playerId} disconnected`);
          break;
        }
      }
    });
  }

  /** Top-level message dispatcher: routes to join or action handlers. */
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

  /**
   * Processes a "join" message: assigns a player ID, queues the client,
   * and starts the game if two players are now ready.
   */
  private handleJoin(ws: WebSocket, msg: JoinMessage): void {
    if (this.state !== null) {
      this.send(ws, { type: 'error', message: 'Game already in progress' });
      return;
    }

    const playerId = `p${++this.playerCounter}` as PlayerId;
    this.pending.push({ ws, join: msg, playerId });
    this.send(ws, { type: 'assigned', playerId });

    console.log(`${msg.name} joined as ${playerId}`);

    if (this.pending.length < 2) {
      this.send(ws, { type: 'waiting' });
      return;
    }

    // Two players ready — start the game
    this.startGame();
  }

  /**
   * Initialises the game state from the two pending players' configurations,
   * promotes them to active players, and broadcasts the initial state.
   * Uses `Date.now()` as the RNG seed for non-deterministic live games.
   */
  private startGame(): void {
    const [p1, p2] = this.pending;

    const config: GameConfig = {
      players: [
        this.toPlayerConfig(p1),
        this.toPlayerConfig(p2),
      ],
      seed: Date.now(),
    };

    this.state = createGame(config, this.cardPool);

    this.players.set(p1.playerId as string, { ws: p1.ws, playerId: p1.playerId });
    this.players.set(p2.playerId as string, { ws: p2.ws, playerId: p2.playerId });
    this.pending = [];

    console.log('Game started!');
    console.log(formatGameState(this.state));

    this.broadcastState();
  }

  /** Converts a pending player's join message into the engine's PlayerConfig shape. */
  private toPlayerConfig(p: PendingPlayer): PlayerConfig {
    return {
      id: p.playerId,
      name: p.join.name,
      draftPool: p.join.draftPool,
      startingMinorItems: p.join.startingMinorItems,
      playDeck: p.join.playDeck,
      siteDeck: p.join.siteDeck,
      startingHaven: p.join.startingHaven,
    };
  }

  /**
   * Processes a game action from a connected client.
   *
   * Looks up the player ID by WebSocket reference, injects it into the
   * action (so clients cannot impersonate each other), runs the reducer,
   * and broadcasts the updated state on success or sends an error on failure.
   */
  private handleAction(ws: WebSocket, action: GameAction): void {
    if (!this.state) {
      this.send(ws, { type: 'error', message: 'Game not started' });
      return;
    }

    // Find the player for this websocket
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

    // Inject playerId into the action
    const actionWithPlayer = { ...action, player: playerId };

    const result = reduce(this.state, actionWithPlayer);
    if (result.error) {
      this.send(ws, { type: 'error', message: result.error });
      return;
    }

    this.state = result.state;
    console.log(`Action: ${action.type} by ${playerId}`);
    console.log(formatGameState(this.state));

    this.broadcastState();
  }

  /**
   * Sends each active player their own projected view of the game state.
   * Hidden information (opponent's hand, face-down cards, etc.) is stripped
   * by {@link projectPlayerView} before transmission.
   */
  private broadcastState(): void {
    if (!this.state) return;

    for (const [, { ws, playerId }] of this.players.entries()) {
      const view = projectPlayerView(this.state, playerId);
      this.send(ws, { type: 'state', view });
    }
  }

  /** Serialises and sends a message if the socket is still open. */
  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}
