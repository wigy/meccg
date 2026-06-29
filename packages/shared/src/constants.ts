/**
 * @module constants
 *
 * Core numeric constants drawn from the MECCG rulebook. These govern deck
 * construction limits, combat modifiers, and victory conditions. Centralised
 * here so the server engine and any future validation logic share a single
 * source of truth.
 */

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
 * Marshalling point threshold that triggers the Free Council.
 * When any player reaches this total, the endgame begins after the
 * current turn concludes.
 */
export const FREE_COUNCIL_MP_THRESHOLD = 25;

/**
 * Visual divider line printed before and after game state output on the
 * server console. Makes it easy to distinguish state snapshots from
 * surrounding log lines (action logs, legal-action reasoning, effects).
 */
export const STATE_DIVIDER = '════════════════════════════════════════════════════════════════════════════════';
