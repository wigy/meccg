/**
 * @module actions-universal
 *
 * Action types available across multiple game phases.
 *
 * These include corruption checks, card draw/discard, passing priority,
 * calling the Free Council, deck exhaustion handling, sideboard access
 * (both resource and hazard), chain-of-effects interactions, the game-end
 * acknowledgement, and the not-playable placeholder.
 */

import type { PlayerId, CardInstanceId } from './common.js';

/**
 * Trigger a corruption check on one of your own characters.
 *
 * The character rolls 2d6. If the roll is greater than their total
 * corruption points (from items + corruption hazards + modifiers), they
 * pass. Otherwise, they fail and are removed from the game -- the
 * opponent does NOT receive marshalling points for this loss.
 * Corruption checks can be called by either player during Movement/Hazard,
 * Site, and Free Council phases.
 */
export interface CorruptionCheckAction {
  readonly type: 'corruption-check';
  /** The player whose character is making the check. */
  readonly player: PlayerId;
  /** The character instance making the corruption check. */
  readonly characterId: CardInstanceId;
  /** The character's total corruption points at the time the check was generated. */
  readonly corruptionPoints: number;
  /**
   * Total modifier applied to the 2d6 roll. Includes the character's own
   * corruption check modifier from the card definition, plus any situational
   * bonuses (e.g. +2 for Ringwraith/Balrog in company).
   */
  readonly corruptionModifier: number;
  /**
   * Card instance IDs of possessions (items, allies, corruption cards) that
   * will be discarded if the corruption check fails. Pre-computed at action
   * generation time so the client can display what's at stake.
   */
  readonly possessions: readonly CardInstanceId[];
  /** The unmodified 2d6 value needed for success (roll > CP, adjusted for modifier). */
  readonly need: number;
  /** Human-readable breakdown of the target number and modifiers. */
  readonly explanation: string;
}

/**
 * Draw cards from the play deck into hand.
 *
 * Used primarily during the End-of-Turn phase to refill to hand size.
 * If the deck is empty, the discard pile is reshuffled to form a new deck
 * (incrementing deckExhaustionCount).
 */
export interface DrawCardsAction {
  readonly type: 'draw-cards';
  /** The player drawing cards. */
  readonly player: PlayerId;
  /** Number of cards to draw. */
  readonly count: number;
}

/**
 * Discard a card from hand to the discard pile.
 *
 * Used during End-of-Turn to trim down to hand size, or at other
 * times when the rules require discarding.
 */
export interface DiscardCardAction {
  readonly type: 'discard-card';
  /** The player discarding. */
  readonly player: PlayerId;
  /** The card instance to discard from hand. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Pass priority, indicating the player has no more actions this phase.
 *
 * Available in every phase. In some phases (like Untap and Long-event),
 * passing is the only available action and simply advances to the next phase.
 * In other phases, it signals the player is done with their optional actions.
 */
export interface PassAction {
  readonly type: 'pass';
  /** The player passing. */
  readonly player: PlayerId;
}

/**
 * Call the Free Council, triggering the endgame.
 *
 * Available during End-of-Turn phase. Once called, the game proceeds to
 * the Free Council phase after the current turn completes. Both players
 * then face final corruption checks and marshalling points are tallied.
 * The Free Council is also automatically triggered when a player exhausts
 * their deck for the second time.
 */
export interface CallFreeCouncilAction {
  readonly type: 'call-free-council';
  /** The player calling the Free Council. */
  readonly player: PlayerId;
}

/**
 * Acknowledge deck exhaustion: return sites to location deck, shuffle the
 * discard pile into a new play deck, and increment the exhaustion counter.
 *
 * This is triggered as an explicit action when a player's play deck runs
 * empty after drawing. In the future, sideboard exchange will be added as
 * additional interactive steps before the reshuffle.
 */
export interface DeckExhaustAction {
  readonly type: 'deck-exhaust';
  /** The player whose deck is exhausted. */
  readonly player: PlayerId;
}

/**
 * Exchange one card between discard pile and sideboard during deck exhaustion.
 *
 * Per CoE rule section 10, when a player's deck is exhausted they may exchange
 * up to 5 cards between their discard pile and sideboard (any card type)
 * before the discard is reshuffled into a new play deck.
 */
export interface ExchangeSideboardAction {
  readonly type: 'exchange-sideboard';
  /** The player exchanging cards. */
  readonly player: PlayerId;
  /** The card moving from the discard pile to the sideboard. */
  readonly discardCardInstanceId: CardInstanceId;
  /** The card moving from the sideboard to the discard pile. */
  readonly sideboardCardInstanceId: CardInstanceId;
}

/**
 * Declare intent to fetch 1 card from sideboard to the play deck.
 *
 * Per CoE rule 2.II.6, the resource player taps their avatar and then
 * selects exactly 1 resource/character from the sideboard to shuffle
 * into the play deck. Requires at least 5 cards in the play deck.
 *
 * This action taps the avatar and enters the sideboard-to-deck sub-flow.
 * The player must then select a card via {@link FetchFromSideboardAction}.
 */
export interface StartSideboardToDeckAction {
  readonly type: 'start-sideboard-to-deck';
  /** The player starting sideboard access. */
  readonly player: PlayerId;
  /** The avatar character being tapped. */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * Declare intent to fetch up to 5 cards from sideboard to the discard pile.
 *
 * Per CoE rule 2.II.6, the resource player taps their avatar and then
 * selects 1-5 resources/characters from the sideboard to place in the
 * discard pile.
 *
 * This action taps the avatar and enters the sideboard-to-discard sub-flow.
 * The player then selects cards one at a time via {@link FetchFromSideboardAction},
 * and may pass after at least 1 card has been fetched.
 */
export interface StartSideboardToDiscardAction {
  readonly type: 'start-sideboard-to-discard';
  /** The player starting sideboard access. */
  readonly player: PlayerId;
  /** The avatar character being tapped. */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * Fetch a specific card from the sideboard during the sideboard access sub-flow.
 *
 * Can only be used after a {@link StartSideboardToDeckAction} or
 * {@link StartSideboardToDiscardAction} has been executed. The destination
 * (deck or discard) is determined by which start action was used.
 */
export interface FetchFromSideboardAction {
  readonly type: 'fetch-from-sideboard';
  /** The player fetching from their sideboard. */
  readonly player: PlayerId;
  /** The sideboard card being fetched. */
  readonly sideboardCardInstanceId: CardInstanceId;
}

// ---- Untap hazard sideboard access ----

/**
 * Declare intent to fetch 1 hazard from sideboard to the play deck during untap.
 *
 * Per CoE rule 2.I, the hazard player may access their sideboard if the
 * resource player's avatar is in play. Fetching 1 hazard to deck requires
 * at least 5 cards in the play deck. This halves the hazard limit for
 * the upcoming M/H phase.
 */
export interface StartHazardSideboardToDeckAction {
  readonly type: 'start-hazard-sideboard-to-deck';
  /** The hazard (non-active) player accessing their sideboard. */
  readonly player: PlayerId;
}

/**
 * Declare intent to fetch up to 5 hazards from sideboard to the discard pile during untap.
 *
 * Per CoE rule 2.I, the hazard player may access their sideboard if the
 * resource player's avatar is in play. This halves the hazard limit for
 * the upcoming M/H phase.
 */
export interface StartHazardSideboardToDiscardAction {
  readonly type: 'start-hazard-sideboard-to-discard';
  /** The hazard (non-active) player accessing their sideboard. */
  readonly player: PlayerId;
}

/**
 * Fetch a specific hazard from the sideboard during the untap hazard sideboard sub-flow.
 *
 * Can only be used after a {@link StartHazardSideboardToDeckAction} or
 * {@link StartHazardSideboardToDiscardAction} has been executed.
 */
export interface FetchHazardFromSideboardAction {
  readonly type: 'fetch-hazard-from-sideboard';
  /** The hazard player fetching from their sideboard. */
  readonly player: PlayerId;
  /** The sideboard card being fetched. */
  readonly sideboardCardInstanceId: CardInstanceId;
}

// ---- Non-viable placeholder ----

/**
 * Placeholder action attached to hand cards that have no legal play
 * during the current phase. Never submitted — exists only as a
 * non-viable {@link EvaluatedAction} so the client can show a tooltip
 * explaining why the card cannot be used right now.
 */
export interface NotPlayableAction {
  readonly type: 'not-playable';
  /** The player holding the card. */
  readonly player: PlayerId;
  /** The card instance in hand that cannot be played. */
  readonly cardInstanceId: CardInstanceId;
}

// ---- Chain of Effects actions ----

/**
 * Pass priority in the current chain of effects.
 *
 * When a player has priority during the declaring phase of a chain,
 * they may pass instead of declaring an action. When both players pass
 * consecutively, the chain transitions to resolving mode.
 */
export interface PassChainPriorityAction {
  readonly type: 'pass-chain-priority';
  /** The player passing priority. */
  readonly player: PlayerId;
}

/**
 * Choose the order of multiple simultaneously-triggered passive conditions.
 *
 * When multiple passive conditions trigger at the same time during chain
 * resolution, the resource player chooses the order in which they are
 * declared in the follow-up chain.
 */
export interface OrderPassivesAction {
  readonly type: 'order-passives';
  /** The player ordering the passives (always the resource player). */
  readonly player: PlayerId;
  /** The ordered list of source card instance IDs, in the desired declaration order. */
  readonly order: readonly CardInstanceId[];
}

/**
 * Acknowledge the game result and record it to player history.
 * Sent by each player after reviewing the final scoring table.
 */
export interface FinishedAction {
  readonly type: 'finished';
  /** The player acknowledging the result. */
  readonly player: PlayerId;
}
