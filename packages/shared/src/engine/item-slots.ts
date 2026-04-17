/**
 * @module item-slots
 *
 * Implements MECCG rule 9.15: a character may bear any number of items but
 * only **use** one weapon, armor, shield, helmet at a time. Corruption
 * points and marshalling points are attributes of the card (carrying), not
 * effects of the item (using), so they always apply regardless of whether
 * the item is "in use".
 *
 * Currently only the **helmet** slot is enforced (Dragons expansion plan
 * step 3 / rule 1.1). Weapon/armor/shield enforcement is a separate step;
 * the dispatch table is generic so adding them is just appending to
 * {@link SLOT_KEYWORDS}.
 *
 * "In use" selection: the first item carrying the slot keyword (in the
 * character's `items` array order) wins. The active player's right to
 * switch which item is in use (rule 9.16) is not yet modeled — when it is,
 * this module is the place to wire it.
 */

import type { CardDefinition, CardInstance, CharacterInPlay, GameState, Keyword } from '../index.js';
import { resolveDef } from './effects/index.js';

/**
 * Item-slot keywords for which "only one in use per character" is enforced.
 * Order is irrelevant; uniqueness is checked per keyword independently.
 *
 * Keep this list in lockstep with the rule 9.15 implementation. To enable
 * enforcement for a new slot, add the keyword and the dedup applies
 * automatically.
 */
export const SLOT_KEYWORDS: readonly Keyword[] = ['helmet'];

/**
 * Returns the slot keyword carried by an item definition, or `null` if the
 * item is not slotted. An item with multiple slot keywords (e.g. a
 * hypothetical helmet+armor) is bucketed under whichever keyword appears
 * first in {@link SLOT_KEYWORDS}.
 */
export function getItemSlot(def: CardDefinition | undefined): Keyword | null {
  if (!def || !('keywords' in def) || !def.keywords) return null;
  for (const slot of SLOT_KEYWORDS) {
    if (def.keywords.includes(slot)) return slot;
  }
  return null;
}

/**
 * Returns the set of item instance IDs whose **effects** apply on the given
 * character. Non-slotted items are always included. For each slot keyword,
 * only the first matching item (in carrying order) is included; subsequent
 * items in the same slot are silenced for effect-collection purposes.
 *
 * Callers should still apply per-item corruption points and marshalling
 * points from every borne item — those are not effects.
 */
export function pickActiveItems(
  state: GameState,
  items: readonly CardInstance[],
): ReadonlySet<string> {
  const active = new Set<string>();
  const slotsTaken = new Set<Keyword>();
  for (const item of items) {
    const def = resolveDef(state, item.instanceId);
    const slot = getItemSlot(def);
    if (slot === null) {
      active.add(item.instanceId as string);
      continue;
    }
    if (slotsTaken.has(slot)) continue;
    slotsTaken.add(slot);
    active.add(item.instanceId as string);
  }
  return active;
}

/**
 * Convenience wrapper: returns the active-item set for a character.
 * Equivalent to {@link pickActiveItems} called with `char.items`.
 */
export function pickActiveItemsForCharacter(
  state: GameState,
  char: CharacterInPlay,
): ReadonlySet<string> {
  return pickActiveItems(state, char.items);
}
