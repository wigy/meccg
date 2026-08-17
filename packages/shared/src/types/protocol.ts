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

import type { PlayerId, CardDefinitionId, Alignment, DieRoll, ById } from './common.js';
import type { GameAction } from './actions.js';
import type { PlayerView } from './player-view.js';
import type { DeckList } from './cards-deck.js';

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
  /** Character and starting minor item definition IDs available for the pre-game draft. */
  readonly draftPool: readonly CardDefinitionId[];
  /** Resource and hazard card definition IDs forming the main shuffled draw pile. */
  readonly playDeck: readonly CardDefinitionId[];
  /** Site card definition IDs the player brings for movement destinations. */
  readonly siteDeck: readonly CardDefinitionId[];
  /** Reserve card definition IDs for the sideboard. */
  readonly sideboard: readonly CardDefinitionId[];
  /**
   * Anti-Fallen-wizard sideboard (MEWH): up to 10 card definition IDs
   * preselected for facing a Fallen-wizard opponent. Added to the main
   * sideboard at game start when the opponent is a Fallen-wizard.
   */
  readonly antiFwSideboard?: readonly CardDefinitionId[];
  /**
   * The structured deck list exactly as the deck editor validated it.
   *
   * Carried so the server runs deck validation on the SAME input the editor
   * did, rather than reconstructing the play-deck section grouping from the
   * flat {@link playDeck}. That reconstruction re-bucketed cards by their
   * `cardType`, mis-filing character-typed cards a player legitimately placed
   * in the hazard section — agents (e.g. Baduila) and Nazgûl played as hazard
   * creatures — into the character bucket, so the server could compute
   * different resource/hazard/creature totals and reject a deck the editor
   * accepted. When present, the server validates this verbatim; when absent
   * (older clients, the pseudo-AI, or a minimal reconnect join) it falls back
   * to reconstructing the deck list from the flat card lists above.
   *
   * Only used for validation — the flat {@link playDeck}/{@link draftPool}
   * lists still drive gameplay deck construction.
   */
  readonly deckList?: DeckList;
  /**
   * True when this seat is played by an AI (headless AI client, pseudo-AI
   * relay), false/absent for a human. Recorded in the completed-game
   * statistics; servers fall back to the `AI-` name-prefix convention for
   * clients that predate the field.
   */
  readonly ai?: boolean;
  /** Optional JWT token for authenticated game server connections (lobby mode). */
  readonly token?: string;
  /**
   * Attach as an *observer* rather than as a player or a spectator
   * (`specs/2026-08-17-ask-ai-observer.md`): a headless process that answers
   * {@link AskAiMessage} with an explanation of what `agent` would do in the
   * current position.
   *
   * An observer never acts, is never seated, receives no state broadcasts, and
   * never keeps a session alive. Only one is attached at a time — a second
   * replaces the first, because the Ask AI control names one agent.
   */
  readonly observer?: {
    /** Sim registry spec of the explaining agent, e.g. `h2` or `mc:ms=2000`. */
    readonly agent: string;
  };
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
  /**
   * Canonical id of the action, as stamped on the `EvaluatedAction` the
   * server last sent to this player. Optional for backwards compatibility
   * — when absent, the server derives the id from `action` directly.
   */
  readonly actionId?: string;
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

/**
 * Sent by a client to re-seed the server's RNG with a fresh random seed.
 * Useful during development to try different card draw outcomes.
 */
export interface ReseedMessage {
  /** Message type discriminant. */
  readonly type: 'reseed';
}

/**
 * Sent by a client to undo the most recent action and revert to the
 * previous game state. Only available in developer mode.
 */
export interface UndoMessage {
  /** Message type discriminant. */
  readonly type: 'undo';
}

/**
 * Dev-only: set the result of the next dice roll (2-12).
 * The individual dice are randomly split to produce the target total.
 */
export interface CheatRollMessage {
  /** Message type discriminant. */
  readonly type: 'cheat-roll';
  /** The desired total (2-12) for the next 2d6 roll. */
  readonly total: number;
}

/**
 * Dev-only: summon a card by name from any zone into the requesting player's hand.
 * Searches both players' decks, discard piles, sideboards, and eliminated piles
 * for a card instance whose definition name matches (case-insensitive).
 */
export interface SummonCardMessage {
  /** Message type discriminant. */
  readonly type: 'summon-card';
  /** The card name to search for (case-insensitive substring match). */
  readonly cardName: string;
}

/**
 * Dev-only: swap hands between the two players.
 * Both players' hand contents are exchanged.
 */
export interface SwapHandMessage {
  /** Message type discriminant. */
  readonly type: 'swap-hand';
}

/**
 * Tutorial games only: the player acknowledges a continue-gated Mentor beat
 * (see TutorialBeat.waitForContinue) — the paused Mentor pump resumes.
 */
export interface TutorialContinueMessage {
  /** Message type discriminant. */
  readonly type: 'tutorial-continue';
}

/**
 * Ask the attached observer what its agent would do in the current position
 * (`specs/2026-08-17-ask-ai-observer.md`).
 *
 * Answered with an {@link AiExplanationMessage} addressed to the asker alone:
 * the explanation is derived from one seat's private view, so it is never
 * broadcast. Reading only — it changes no state and does not taint the game.
 */
export interface AskAiMessage {
  /** Message type discriminant. */
  readonly type: 'ask-ai';
  /** Client-generated id, echoed back on the answer so a late reply can be matched. */
  readonly requestId: string;
}

/**
 * Observer → server: the finished explanation for one {@link AiQuestionMessage}.
 *
 * Accepted only from the attached observer connection; from anyone else it is
 * an error, the same way an action from a spectator is.
 */
export interface AiAnswerMessage {
  /** Message type discriminant. */
  readonly type: 'ai-answer';
  /** The id from the question being answered. */
  readonly requestId: string;
  /** The rendered explanation, one element per line. */
  readonly lines: readonly string[];
  /** Agent spec that produced it, as the observer was launched with. */
  readonly agent: string;
  /** Wall-clock milliseconds the agent spent thinking. */
  readonly elapsedMs: number;
}

/** Observer → server: this question cannot be answered. */
export interface AiErrorMessage {
  /** Message type discriminant. */
  readonly type: 'ai-error';
  /** The id from the question that failed. */
  readonly requestId: string;
  /** What went wrong, shown to the asker verbatim. */
  readonly message: string;
}

export type ClientMessage = JoinMessage | ActionMessage | SaveMessage | LoadMessage | ReseedMessage | UndoMessage | CheatRollMessage | SummonCardMessage | SwapHandMessage | TutorialContinueMessage | AskAiMessage | AiAnswerMessage | AiErrorMessage;

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
  /**
   * The action that triggered this state update, if any.
   * Present when the state change was caused by a player action (not
   * reconnection or initial state). Clients can use this to display a
   * notification describing what the opponent just did.
   */
  readonly lastAction?: GameAction;
  /**
   * Card definition IDs for every CardInstanceId referenced in
   * {@link lastAction}, resolved against the post-action authoritative
   * state. Present iff `lastAction` is present.
   *
   * Card plays are public, but the played card may land in a pile whose
   * contents the opponent cannot peruse (e.g. a short-event that moves
   * straight from the player's hand to their face-down discard pile).
   * With only the projected `view`, the client cannot map the action's
   * instance IDs back to card names. This field lets `describeAction`
   * name the played card in the opponent's toast and log without
   * widening the general projection.
   */
  readonly lastActionCardDefs?: ById<CardDefinitionId>;
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
  /**
   * Final total including prowess/modifier (e.g. die1 + die2 + prowess).
   * Present for CvCC strikes and body checks. Absent for raw d6 rolls.
   * Prowess = total - die1 - die2.
   */
  readonly total?: number;
}

/**
 * A text notification broadcast to all clients.
 * Used to inform players about automatic game events that have no
 * corresponding interactive action (e.g. a player skipping an optional
 * fetch-to-deck effect by passing).
 */
export interface TextNotificationEffect {
  readonly effect: 'text-notification';
  /** Human-readable message describing what happened. */
  readonly message: string;
}

/** Union of all visual effect types. */
export type GameEffect = DiceRollEffect | TextNotificationEffect;

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

/**
 * Generic informational message from the server (e.g. operation confirmations).
 */
export interface InfoMessage {
  /** Message type discriminant. */
  readonly type: 'info';
  /** Human-readable message. */
  readonly message: string;
  /** Optional visual tone: success renders green, error renders red. */
  readonly tone?: 'success' | 'error';
}

/**
 * Sent by the server in dev mode to forward engine log output to the client.
 * Each line is a raw console log entry (with ANSI color codes) from the
 * legal-actions subsystem. Only sent when both server and client are in dev mode.
 */
export interface LogMessage {
  /** Message type discriminant. */
  readonly type: 'log';
  /** Engine log lines captured during the most recent reduce() call. */
  readonly lines: readonly string[];
}

/**
 * Sent by the server whenever the set of spectators watching this game
 * changes, and to each client as it is seated so its watcher badge starts
 * correct.
 *
 * This cannot ride along on {@link StateMessage}: spectators arriving and
 * leaving does not change the game state, so the badge would only refresh on
 * the next move. Names are deduplicated — one person watching from two tabs
 * is one watcher.
 */
export interface SpectatorsMessage {
  /** Message type discriminant. */
  readonly type: 'spectators';
  /** Display names of everyone currently watching, sorted, without duplicates. */
  readonly names: readonly string[];
}

/**
 * Sent by the server whenever an observer attaches or detaches, and to each
 * client as it is seated (`specs/2026-08-17-ask-ai-observer.md`).
 *
 * Separate from {@link SpectatorsMessage} for the same reason that one is
 * separate from the state broadcast — an observer arriving changes no game
 * state — and separate from the watcher list because an observer is a tool, not
 * a person watching. This is what makes the Ask AI control appear.
 */
export interface ObserverMessage {
  /** Message type discriminant. */
  readonly type: 'observer';
  /** Whether an observer is currently attached. */
  readonly attached: boolean;
  /** Its agent spec, or null when nothing is attached. */
  readonly agent: string | null;
}

/**
 * Server → observer: explain this position.
 *
 * Carries the authoritative `stateSeq` rather than letting the observer guess
 * from its own log tail, so the answer is about the position the asker is
 * looking at.
 */
export interface AiQuestionMessage {
  /** Message type discriminant. */
  readonly type: 'ai-question';
  /** Id to echo back on the answer. */
  readonly requestId: string;
  /** Engine state sequence number to explain — addresses the game-log record. */
  readonly stateSeq: number;
  /** Whose decision to explain. */
  readonly forPlayer: PlayerId;
  /** Turn number, for the observer's own logging. */
  readonly turn: number;
  /** Phase name, likewise. */
  readonly phase: string;
  /** Setup step, when in setup. */
  readonly step?: string;
}

/** Server → asker: the explanation, or why there is none. */
export interface AiExplanationMessage {
  /** Message type discriminant. */
  readonly type: 'ai-explanation';
  /** The id of the {@link AskAiMessage} being answered. */
  readonly requestId: string;
  /** How it went: `unavailable` means no observer is attached. */
  readonly status: 'ok' | 'unavailable' | 'error' | 'timeout';
  /** Agent spec that answered, or null when nothing did. */
  readonly agent: string | null;
  /** Seat the explanation is about. */
  readonly forPlayer?: PlayerId;
  /** Position explained. */
  readonly stateSeq?: number;
  /** The explanation, one element per line. Present when `status` is `ok`. */
  readonly lines?: readonly string[];
  /** Wall-clock milliseconds the agent spent thinking. */
  readonly elapsedMs?: number;
  /** Why there is no explanation. Present when `status` is not `ok`. */
  readonly message?: string;
}

export type ServerMessage = AssignedMessage | StateMessage | ErrorMessage | WaitingMessage | DisconnectedMessage | RestartMessage | DraftRevealMessage | EffectMessage | InfoMessage | LogMessage | SpectatorsMessage | ObserverMessage | AiQuestionMessage | AiExplanationMessage;
