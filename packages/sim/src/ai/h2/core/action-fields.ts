/**
 * @module ai/h2/core/action-fields
 *
 * Reading the card or character an action names, whatever it calls the field.
 *
 * Six bugs in this project have had exactly one shape: a module reads
 * `action.cardInstanceId`, the engine keeps the answer in
 * `action.characterInstanceId`, and the module silently declines every
 * candidate of that type. The list so far —
 *
 * - `characters` on `move-to-influence` (`characterInstanceId`)
 * - `combat` on `choose-strike-order` (`strikeIndex`, not the optional
 *   `characterId` documented as "informational, for UI display")
 * - `corruption` on where an attached card keeps its corruption
 * - `fetching` on the character draft (`draftState[].pool`)
 * - `fetching` again on the deck draft (`deckDraftState[].remainingPool`)
 * - `events` on Stealth (`targetScoutInstanceId`, not `targetCharacterId`)
 *
 * — and every one was invisible for the same reason: a module that finds
 * nothing declines, and in the coverage report a decline reads exactly like an
 * action type nobody owns, unless the two are counted apart.
 *
 * The engine is not wrong to name fields specifically; `targetScoutInstanceId`
 * says something `targetCharacterId` does not. What is wrong is each module
 * guessing which spelling it will meet. So the spellings live here, in one
 * list, and a module that wants "the character this action is about" asks for
 * that instead.
 */

import type { CardInstanceId, GameAction } from '@meccg/shared';

/** Fields an action uses to name a card being played, chosen or spent. */
const CARD_FIELDS = [
  'cardInstanceId',
  'sideboardCardInstanceId',
  'itemInstanceId',
  'sourceCardId',
] as const;

/**
 * Fields an action uses to name the character it is about.
 *
 * `characterInstanceId` and `characterId` are both in use for the actor;
 * the `target*` spellings name whoever the action is aimed at. A module
 * usually wants either, which is why they are one list — an action does not
 * carry both meanings at once.
 */
const CHARACTER_FIELDS = [
  'characterId',
  'characterInstanceId',
  'targetCharacterId',
  'targetScoutInstanceId',
  'targetInstanceId',
] as const;

/**
 * Fields naming the card an action *gives up*, where an action has two legs.
 *
 * Almost every action names one card, which is why {@link namedCard} answers
 * "the card this is about" and that is enough. `exchange-sideboard` names two:
 * a sideboard card joining the discard pile that is about to be reshuffled into
 * the play deck, and a discard card leaving it for the sideboard. Reading only
 * the first would price a swap as a gift.
 *
 * Kept as its own list rather than folded into {@link CARD_FIELDS} because the
 * two mean opposite things — an action carrying both would otherwise resolve to
 * whichever spelling happens to come first.
 */
const GIVEN_UP_FIELDS = [
  'discardCardInstanceId',
] as const;

/**
 * Fields naming an in-play card an action discards *as its effect* — Marvels
 * Told, Voices of Malice, Ancient Secrets and The Cock Crows each enumerate
 * one `play-short-event` action per eligible target, carrying the chosen
 * instance here. Distinct from {@link GIVEN_UP_FIELDS}: that names a card
 * leaving the actor's own zone as a cost; this names a card elsewhere in play
 * — on either side of the table — that the effect removes.
 */
const DISCARD_TARGET_FIELDS = [
  'discardTargetInstanceId',
] as const;

/** The first of `fields` the action carries, or undefined. */
function firstOf(action: GameAction, fields: readonly string[]): CardInstanceId | undefined {
  const record = action as unknown as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) return value as CardInstanceId;
  }
  return undefined;
}

/** The card an action names, under any of the spellings the engine uses. */
export function namedCard(action: GameAction): CardInstanceId | undefined {
  return firstOf(action, CARD_FIELDS);
}

/** The character an action is about, under any of the spellings the engine uses. */
export function namedCharacter(action: GameAction): CardInstanceId | undefined {
  return firstOf(action, CHARACTER_FIELDS);
}

/** The card an action gives up, for the actions that trade one card for another. */
export function namedGivenUpCard(action: GameAction): CardInstanceId | undefined {
  return firstOf(action, GIVEN_UP_FIELDS);
}

/** The in-play card an action's effect discards, under any spelling the engine uses. */
export function namedDiscardTarget(action: GameAction): CardInstanceId | undefined {
  return firstOf(action, DISCARD_TARGET_FIELDS);
}

/** Every spelling this module knows, for the test that keeps the list honest. */
export const KNOWN_FIELDS = {
  card: CARD_FIELDS,
  character: CHARACTER_FIELDS,
  givenUp: GIVEN_UP_FIELDS,
  discardTarget: DISCARD_TARGET_FIELDS,
} as const;
