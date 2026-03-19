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

interface PendingPlayer {
  ws: WebSocket;
  join: JoinMessage;
  playerId: PlayerId;
}

export class GameSession {
  private state: GameState | null = null;
  private players: Map<string, { ws: WebSocket; playerId: PlayerId }> = new Map();
  private pending: PendingPlayer[] = [];
  private cardPool: Readonly<Record<string, CardDefinition>>;
  private playerCounter = 0;

  constructor() {
    this.cardPool = loadCardPool();
  }

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

  private broadcastState(): void {
    if (!this.state) return;

    for (const [, { ws, playerId }] of this.players.entries()) {
      const view = projectPlayerView(this.state, playerId);
      this.send(ws, { type: 'state', view });
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}
