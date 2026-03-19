import type { PlayerId, CardDefinitionId } from './common.js';
import type { GameAction } from './actions.js';
import type { PlayerView } from './player-view.js';

// ---- Client → Server ----

export interface JoinMessage {
  readonly type: 'join';
  readonly name: string;
  readonly draftPool: readonly CardDefinitionId[];
  readonly startingMinorItems: readonly CardDefinitionId[];
  readonly playDeck: readonly CardDefinitionId[];
  readonly siteDeck: readonly CardDefinitionId[];
  readonly startingHaven: CardDefinitionId;
}

export interface ActionMessage {
  readonly type: 'action';
  readonly action: GameAction;
}

export type ClientMessage = JoinMessage | ActionMessage;

// ---- Server → Client ----

export interface AssignedMessage {
  readonly type: 'assigned';
  readonly playerId: PlayerId;
}

export interface StateMessage {
  readonly type: 'state';
  readonly view: PlayerView;
}

export interface ErrorMessage {
  readonly type: 'error';
  readonly message: string;
}

export interface WaitingMessage {
  readonly type: 'waiting';
}

export type ServerMessage = AssignedMessage | StateMessage | ErrorMessage | WaitingMessage;
