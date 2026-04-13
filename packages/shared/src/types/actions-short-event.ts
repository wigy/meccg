/**
 * @module actions-short-event
 *
 * Action types for playing short-event resource cards.
 *
 * Short events can cancel environments or trigger sub-flows such as
 * fetching cards from the sideboard or discard pile. They initiate a
 * chain of effects so both players can respond before resolution.
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
   * For cards with a `play-target` of `own-hobbit` (e.g. Halfling Strength),
   * the hobbit character targeted by the short event.
   */
  readonly targetCharacterId?: CardInstanceId;
  /**
   * For cards offering a choice of effects (e.g. Halfling Strength: untap,
   * heal, or corruption-check-boost), which mode the player selected.
   */
  readonly mode?: string;
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
