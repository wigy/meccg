/**
 * @module actions-short-event
 *
 * Action types for playing short-event resource cards.
 *
 * Short events can cancel environments, fetch cards from the sideboard or
 * discard pile, or force the discard of an in-play hazard event. All
 * targets are specified up-front on the action; the reducer then applies
 * costs and effects in one step.
 */

import type { PlayerId, CardInstanceId } from './common.js';

/**
 * Play a short-event card as a resource to cancel and discard an environment.
 *
 * When targeting an environment card (e.g. Twilight canceling a long-event),
 * the `targetInstanceId` identifies the card to cancel. The short event
 * initiates a chain so both players can respond before resolution.
 *
 * When played during the long-event phase as a resource short-event (e.g.
 * Smoke Rings), no target is needed. The card may trigger sub-flows such as
 * fetching a card from the sideboard or discard pile.
 */
export interface PlayShortEventAction {
  readonly type: 'play-short-event';
  /** The player playing the short event. */
  readonly player: PlayerId;
  /** The short-event card instance to play from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The environment card instance to cancel and discard (when targeting an environment). */
  readonly targetInstanceId?: CardInstanceId;
  /**
   * For cards with a `play-target` effect that taps the targeted character
   * (e.g. Stealth taps a scout in the chosen company), the character to tap.
   * One legal action is generated per eligible target so the engine can
   * apply the tap cost when the action is reduced.
   */
  readonly targetScoutInstanceId?: CardInstanceId;
  /**
   * For cards whose `play-target` declares `target: "character"` with a
   * DSL `filter` (e.g. Halfling Strength filtering on
   * `target.race: hobbit`), the chosen character instance the short
   * event resolves against.
   */
  readonly targetCharacterId?: CardInstanceId;
  /**
   * For cards declaring {@link PlayOptionEffect}s (e.g. Halfling Strength),
   * the id of the option the player selected. The reducer dispatches the
   * matching option's `apply` clause via the generic DSL handlers.
   */
  readonly optionId?: string;
  /**
   * For cards with a `discard-in-play` effect (e.g. Marvels Told), the
   * in-play card instance to discard. One legal action is emitted per
   * eligible (sage × hazard) combination so the player picks the target
   * as part of playing the card — there is no separate sub-flow.
   */
  readonly discardTargetInstanceId?: CardInstanceId;
}

/**
 * Reshuffle a card from the player's hand back into their play deck.
 *
 * Available at any strategy-time step for cards that carry the
 * `reshuffle-self-from-hand` ability (e.g. Sudden Call, le-235). The
 * card's identity is revealed to the opponent via the public game log —
 * the "show opponent" clause on the card text.
 */
export interface ReshuffleCardFromHandAction {
  readonly type: 'reshuffle-card-from-hand';
  /** The player reshuffling the card. */
  readonly player: PlayerId;
  /** The card instance (in the player's hand) to return to the deck. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Select a card from the sideboard or discard pile to fetch into the play deck.
 *
 * This action is part of the fetch-to-deck sub-flow initiated by resource
 * short events like Smoke Rings. The player must select exactly one eligible
 * card from the available sources.
 */
export interface FetchFromPileAction {
  readonly type: 'fetch-from-pile';
  /** The player fetching the card. */
  readonly player: PlayerId;
  /** The card instance to fetch. */
  readonly cardInstanceId: CardInstanceId;
  /** Which pile the card is being fetched from. */
  readonly source: 'sideboard' | 'discard-pile';
}
