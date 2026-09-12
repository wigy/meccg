/**
 * @module constants
 *
 * Core numeric constants drawn from the MECCG rulebook. These govern deck
 * construction limits, combat modifiers, and victory conditions. Centralised
 * here so the server engine and any future validation logic share a single
 * source of truth.
 */

import type { GameLength } from './types/cards-deck.js';

/**
 * Total general influence a player starts with (20 points).
 * Characters controlled under general influence deduct their mind value
 * from this pool; exceeding it means a character cannot be played without
 * direct influence from another character.
 */
export const GENERAL_INFLUENCE = 20;

/**
 * Number of cards a player should hold at the end of each turn.
 * During the end-of-turn phase players draw or discard to reach this count.
 */
export const HAND_SIZE = 8;

/**
 * Per-game-length rules for ending the game (CoE rule 10.2 / 10.40). Each
 * {@link GameLength} has its own marshalling-point calling threshold and its
 * own deck-exhaustion counts:
 *
 * - `mpThreshold` — raw MP a player needs to *call* the Free Council once
 *   `callExhaustions` has also been reached.
 * - `callExhaustions` — deck-exhaustion count that, combined with
 *   `mpThreshold`, allows a player to call the Free Council early.
 * - `autoEndExhaustions` — deck-exhaustion count that ends the game
 *   automatically (after the current turn) once *both* players reach it,
 *   regardless of MP.
 */
export const GAME_LENGTH_RULES: Record<GameLength, {
  readonly mpThreshold: number;
  readonly callExhaustions: number;
  readonly autoEndExhaustions: number;
}> = {
  starter: { mpThreshold: 20, callExhaustions: 0, autoEndExhaustions: 1 },
  short: { mpThreshold: 25, callExhaustions: 1, autoEndExhaustions: 2 },
  long: { mpThreshold: 30, callExhaustions: 2, autoEndExhaustions: 3 },
  campaign: { mpThreshold: 40, callExhaustions: 3, autoEndExhaustions: 4 },
};

/**
 * Visual divider line printed before and after game state output on the
 * server console. Makes it easy to distinguish state snapshots from
 * surrounding log lines (action logs, legal-action reasoning, effects).
 */
export const STATE_DIVIDER = '════════════════════════════════════════════════════════════════════════════════';
