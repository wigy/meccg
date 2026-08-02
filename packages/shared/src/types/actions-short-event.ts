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

import type { PlayerId, CardInstanceId, CompanyId } from './common.js';

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
   * For end-of-org cards with `play-target: company` and no tap cost
   * (e.g. Great-road), the company the short event is played on.
   * One legal action is generated per eligible company.
   */
  readonly targetCompanyId?: CompanyId;
  /**
   * For cards with a `discard-in-play` effect (e.g. Marvels Told), the
   * in-play card instance to discard. One legal action is emitted per
   * eligible (sage × hazard) combination so the player picks the target
   * as part of playing the card — there is no separate sub-flow.
   *
   * Reused by the on-guard mode of a {@link WithdrawAgentEffect} card
   * (Withdrawn to Mordor, dm-165) to name the unrevealed on-guard card the
   * event discards.
   */
  readonly discardTargetInstanceId?: CardInstanceId;
  /**
   * For a {@link WithdrawAgentEffect} card (Withdrawn to Mordor, dm-165)
   * played in its agent mode, the virtual-company id of the opponent's
   * face-up agent the event removes. One legal action is emitted per
   * eligible face-up agent.
   */
  readonly targetAgentId?: CompanyId;
  /**
   * For cards with an `enqueue-ring-play-offer` apply (e.g. Secrets of
   * Their Forging), the gold ring item to discard and whose test table
   * determines the eligible replacement ring categories. One legal action
   * is emitted per (sage × gold ring) pair so the player selects both
   * the sage to tap and which gold ring to replace.
   */
  readonly targetGoldRingInstanceId?: CardInstanceId;
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
 * Select a card from the sideboard or discard pile to fetch into the play deck or hand.
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
  readonly source: 'sideboard' | 'discard-pile' | 'deck';
  /** Destination zone. Defaults to `'deck'` for backward compatibility. */
  readonly to?: 'deck' | 'hand';
}

/**
 * One tap-and-discard pick within a `tap-discard-in-play` sub-flow (Praise
 * to Elbereth tw-305). Taps `characterId` (one of the declaring player's own
 * untapped characters) and discards `targetInstanceId` (an untapped opponent
 * in-play card matching the effect's filter) immediately — no chain entry,
 * so the opponent has no window to respond. The pending effect stays queued
 * afterward so the player may repeat the pick; `pass` ends the sub-flow.
 */
export interface TapDiscardInPlayAction {
  readonly type: 'tap-discard-in-play';
  /** The declaring player. */
  readonly player: PlayerId;
  /** The declaring player's own untapped character to tap as the cost. */
  readonly characterId: CardInstanceId;
  /** The opponent's untapped in-play card to discard. */
  readonly targetInstanceId: CardInstanceId;
}
