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
 * Minimum number of resource cards required in a legal play deck.
 * Deck construction validation checks this before the game starts.
 */
export const MIN_PLAY_DECK_RESOURCES = 30;

/**
 * Minimum number of hazard cards required in a legal play deck.
 * Both resource and hazard halves of the play deck are shuffled together.
 */
export const MIN_PLAY_DECK_HAZARDS = 30;

/**
 * Minimum number of creature hazards that must be present in the play deck.
 * Ensures every player brings enough threats for their opponent's movement phase.
 */
export const MIN_CREATURES = 12;

/**
 * Maximum number of copies of any single non-unique card allowed in a deck.
 * Unique cards are limited to one copy regardless of this constant.
 */
export const MAX_CARD_COPIES = 3;

/** Minimum number of cards in a player's sideboard. */
export const MIN_SIDEBOARD = 15;

/** Maximum number of cards in a player's sideboard. */
export const MAX_SIDEBOARD = 30;

/**
 * Maximum number of region cards a company can traverse in a single
 * movement phase. Longer paths are illegal.
 */
export const MAX_REGION_MOVEMENT = 4;

/**
 * Floor for the hazard limit. The hazard limit equals the size of the
 * moving company, but never drops below this value.
 */
export const MIN_HAZARD_LIMIT = 2;

/**
 * Marshalling point threshold that triggers the Free Council.
 * When any player reaches this total, the endgame begins after the
 * current turn concludes.
 */
export const FREE_COUNCIL_MP_THRESHOLD = 25;

/**
 * Prowess penalty applied when a character chooses not to tap against
 * a strike (-3). This is the harshest option but keeps the character
 * untapped for later actions.
 */
export const UNTAPPED_NO_TAP_PROWESS_PENALTY = -3;

/**
 * Prowess penalty for a tapped character facing a strike (-1).
 * Less severe than the untapped-no-tap option but the character is
 * already committed.
 */
export const TAPPED_PROWESS_PENALTY = -1;

/**
 * Prowess penalty for a wounded character facing a strike (-2).
 * Wounded characters are more vulnerable in combat but can still fight.
 */
export const WOUNDED_PROWESS_PENALTY = -2;

/**
 * Prowess bonus granted to a character receiving support from an
 * untapped companion in the same company (+1 per supporter).
 */
export const SUPPORT_PROWESS_BONUS = 1;
