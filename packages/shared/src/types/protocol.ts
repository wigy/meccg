/**
 * @module protocol
 *
 * WebSocket protocol message types for client-server communication.
 *
 * The MECCG architecture uses WebSockets for real-time bidirectional
 * communication between the browser client and the game server. This
 * module defines the message types for both directions:
 *
 * **Client -> Server (`ClientMessage`):**
 * - `JoinMessage` -- Sent once when connecting, with the player's deck configuration.
 * - `ActionMessage` -- Sent during gameplay to submit a game action.
 *
 * **Server -> Client (`ServerMessage`):**
 * - `AssignedMessage` -- Confirms the player's ID assignment after joining.
 * - `StateMessage` -- Delivers the projected `PlayerView` after each state change.
 * - `ErrorMessage` -- Reports illegal actions or other errors.
 * - `WaitingMessage` -- Indicates the server is waiting for the other player.
 *
 * All messages are discriminated by a `type` field for easy dispatching.
 */

import type { PlayerId, CardDefinitionId, Alignment, DieRoll } from './common.js';
import type { GameAction } from './actions.js';
import type { PlayerView } from './player-view.js';

// ---- Client → Server ----

/**
 * Sent by the client when first connecting to a game session.
 *
 * Contains the player's display name and complete deck configuration,
 * including the character draft pool, starting minor items, the main
 * play deck, the site deck for movement destinations, and the haven
 * where the player's initial company begins.
 */
export interface JoinMessage {
  /** Message type discriminant. */
  readonly type: 'join';
  /** The player's chosen display name. */
  readonly name: string;
  /** The alignment of the player's wizard (wizard, ringwraith, fallen-wizard, balrog). */
  readonly alignment: Alignment;
  /** Character definition IDs available for the pre-game draft (up to 10). */
  readonly draftPool: readonly CardDefinitionId[];
  /** Up to 2 non-unique minor item definition IDs chosen as starting equipment. */
  readonly startingMinorItems: readonly CardDefinitionId[];
  /** Resource and hazard card definition IDs forming the main shuffled draw pile. */
  readonly playDeck: readonly CardDefinitionId[];
  /** Site card definition IDs the player brings for movement destinations. */
  readonly siteDeck: readonly CardDefinitionId[];
  /** The havens where the player's starting companies begin. */
  readonly startingHavens: readonly CardDefinitionId[];
}

/**
 * Sent by the client to submit a game action during play.
 *
 * The server validates the action against the current game state and phase
 * before applying it. If the action is illegal, an `ErrorMessage` is sent back.
 */
export interface ActionMessage {
  /** Message type discriminant. */
  readonly type: 'action';
  /** The game action to apply. See `GameAction` for all possible action types. */
  readonly action: GameAction;
}

/**
 * Sent by a client to request a full game reset. The server deletes the
 * save file and forces all clients to reconnect with a fresh game.
 */
export interface ResetMessage {
  /** Message type discriminant. */
  readonly type: 'reset';
}

/**
 * Sent by a client to request the server to save the current game state.
 */
export interface SaveMessage {
  /** Message type discriminant. */
  readonly type: 'save';
}

/**
 * Union of all messages the client can send to the server.
 * Discriminated by the `type` field.
 */
/**
 * Sent by a client to request the server to load the backup save file.
 */
export interface LoadMessage {
  /** Message type discriminant. */
  readonly type: 'load';
}

export type ClientMessage = JoinMessage | ActionMessage | ResetMessage | SaveMessage | LoadMessage;

// ---- Server → Client ----

/**
 * Sent by the server after a client successfully joins a game session.
 *
 * Confirms the player's unique ID, which is used to identify the player
 * in all subsequent actions and state views.
 */
export interface AssignedMessage {
  /** Message type discriminant. */
  readonly type: 'assigned';
  /** The unique player ID assigned to this client for the game session. */
  readonly playerId: PlayerId;
  /** Unique identifier for the game, shared across all clients. */
  readonly gameId: string;
}

/**
 * Sent by the server after each state change to deliver the updated game view.
 *
 * Contains the full projected `PlayerView` with hidden information redacted
 * for this specific player. The client should replace its entire local state
 * with this view on receipt.
 */
export interface StateMessage {
  /** Message type discriminant. */
  readonly type: 'state';
  /** The projected game state for this player, with opponent's hidden info redacted. */
  readonly view: PlayerView;
}

/**
 * Sent by the server when the client submits an illegal action or
 * another error occurs.
 *
 * The client should display the error message to the player and not
 * optimistically update local state -- the previous `StateMessage`
 * remains the authoritative view.
 */
export interface ErrorMessage {
  /** Message type discriminant. */
  readonly type: 'error';
  /** Human-readable description of what went wrong. */
  readonly message: string;
}

/**
 * Sent by the server when it is waiting for another player to act.
 *
 * This lets the client display a "waiting for opponent" indicator.
 * Common scenarios: waiting for the second player to join, waiting
 * for the opponent's draft pick, or waiting for hazard plays.
 */
export interface WaitingMessage {
  /** Message type discriminant. */
  readonly type: 'waiting';
}

/**
 * Union of all messages the server can send to the client.
 * Discriminated by the `type` field.
 */
/**
 * Sent by the server when the opponent disconnects.
 * The game state has been saved to disk and can be resumed
 * when both players reconnect.
 */
export interface DisconnectedMessage {
  /** Message type discriminant. */
  readonly type: 'disconnected';
  /** Human-readable explanation. */
  readonly message: string;
}

/**
 * Sent by the server before shutting down for a code reload.
 * Clients should automatically reconnect after a short delay.
 */
export interface RestartMessage {
  /** Message type discriminant. */
  readonly type: 'restart';
  /** Human-readable explanation. */
  readonly message: string;
}

/**
 * Sent by the server after a draft round is revealed, describing what
 * each player picked and whether there was a collision (set aside).
 */
export interface DraftRevealMessage {
  /** Message type discriminant. */
  readonly type: 'draft-reveal';
  /** Player 1's name. */
  readonly player1Name: string;
  /** What player 1 picked (definition ID), or null if they stopped. */
  readonly player1Pick: CardDefinitionId | null;
  /** Player 2's name. */
  readonly player2Name: string;
  /** What player 2 picked (definition ID), or null if they stopped. */
  readonly player2Pick: CardDefinitionId | null;
  /** Whether the picks collided (both picked the same character). */
  readonly collision: boolean;
}

// ---- Visual effects ----

/**
 * A dice roll result for visual feedback.
 */
export interface DiceRollEffect {
  readonly effect: 'dice-roll';
  /** The player who rolled. */
  readonly playerName: string;
  /** First die result (1-6). */
  readonly die1: DieRoll;
  /** Second die result (1-6). */
  readonly die2: DieRoll;
  /** Context label (e.g. "Initiative", "Corruption check"). */
  readonly label: string;
}

/** Union of all visual effect types. */
export type GameEffect = DiceRollEffect;

/**
 * Sent by the server to trigger a visual effect on the client.
 * Effects are purely presentational — they don't change game state.
 * Clients display them in whatever manner suits them (log, animation, etc.).
 */
export interface EffectMessage {
  /** Message type discriminant. */
  readonly type: 'effect';
  /** The visual effect to display. */
  readonly effect: GameEffect;
}

export type ServerMessage = AssignedMessage | StateMessage | ErrorMessage | WaitingMessage | DisconnectedMessage | RestartMessage | DraftRevealMessage | EffectMessage;
