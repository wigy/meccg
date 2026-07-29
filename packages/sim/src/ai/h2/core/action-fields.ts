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

/** Every spelling this module knows, for the test that keeps the list honest. */
export const KNOWN_FIELDS = {
  card: CARD_FIELDS,
  character: CHARACTER_FIELDS,
} as const;
