/**
 * @module character-attachments
 *
 * Helpers for relating cards in play to the characters they are attached to.
 *
 * Some cards in `cardsInPlay` carry an {@link CardInPlay.attachedTo} field: a
 * permanent event, or a short-event that stays in play once played (e.g.
 * *Flee from Strike*), bound to a specific character — the canonical example
 * being a corruption card left on the character it corrupted.
 *
 * `attachedTo` is also reused for cards bound to other kinds of targets
 * (creatures, allies, factions — see the field's doc comment), so these
 * helpers only ever match instance IDs that are actually characters currently
 * in play; a card attached to anything else is left alone and falls through
 * to the flat cards-in-play row unchanged.
 *
 * The UI presents a character-attached card inline with that character —
 * mirroring how items/allies/hazards hang under it — rather than in the flat
 * cards-in-play row. These helpers give the browser client a single,
 * consistent rule for that partition so a card is never rendered twice nor
 * dropped entirely. They intentionally parallel `company-attachments.ts` and
 * `site-attachments.ts`, which perform the same partition for company- and
 * site-bound cards.
 */

import type { CardInstanceId } from './types/common.js';

/** The subset of a card-in-play needed to relate it to a character. */
interface CharacterBoundCard {
  /** The character this card is attached to, if any. */
  readonly attachedTo?: CardInstanceId;
}

/**
 * The cards in `cardsInPlay` attached to a specific character. Used to render
 * a character's attached permanent/short events inline with its other
 * attachments (items, allies, hazards).
 */
export function cardsAttachedToCharacter<T extends CharacterBoundCard>(
  cardsInPlay: readonly T[],
  characterInstanceId: CardInstanceId,
): readonly T[] {
  return cardsInPlay.filter(c => c.attachedTo === characterInstanceId);
}

/**
 * True when this card is attached to a character that is currently in play —
 * i.e. it is rendered inline with that character and so must be excluded from
 * the flat cards-in-play row. A card whose `attachedTo` target is not a
 * character in play (either the character has left play, or the id refers to
 * a creature/ally/faction instead) falls back to the flat row.
 */
export function isAttachedToPresentCharacter(
  card: CharacterBoundCard,
  presentCharacterIds: ReadonlySet<string>,
): boolean {
  return card.attachedTo != null && presentCharacterIds.has(card.attachedTo as string);
}
