/**
 * @module item-slots
 *
 * Implements MECCG rule 9.15: a character may bear any number of items but
 * only **use** one weapon, armor, shield, helmet at a time. Corruption
 * points and marshalling points are attributes of the card (carrying), not
 * effects of the item (using), so they always apply regardless of whether
 * the item is "in use".
 *
 * All four item slots — weapon, armor, shield, helmet — are enforced: for
 * each slot only the first borne item (in carrying order) is "in use" and
 * contributes its prowess/body modifiers and other effects.
 *
 * Per-character slot capacities can be modified by an
 * {@link ItemSlotModifierEffect} carried on a borne item/enchantment. For
 * example Swordmaster (tw-498) gives an already-warrior sage a second weapon
 * slot ("both modifiers count") at the cost of the shield slot ("if he uses
 * two weapons he can't use a shield").
 *
 * "In use" selection: the first item carrying the slot keyword (in the
 * character's `items` array order) wins. The active player's right to switch
 * which item is in use (rule 9.16) is not yet modeled — when it is, this
 * module is the place to wire it. Where a slot modifier offers a trade-off
 * (two weapons vs. weapon+shield), the engine prefers consuming the extra
 * capacity rather than keeping the excluded slot.
 */

import type { CardDefinition, CardInstance, CharacterInPlay, GameState, Keyword } from '../index.js';
import { resolveDef, getEffectiveNaturalSkills } from './effects/index.js';
import { getCardEffects } from './reducer-utils.js';

/**
 * Item-slot keywords for which "only one in use per character" is enforced.
 * Order is irrelevant; uniqueness is checked per keyword independently.
 *
 * Keep this list in lockstep with the rule 9.15 implementation. To enable
 * enforcement for a new slot, add the keyword and the dedup applies
 * automatically.
 */
export const SLOT_KEYWORDS: readonly Keyword[] = ['weapon', 'armor', 'shield', 'helmet'];

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
 * Computes the per-slot in-use capacity for a character, starting from the
 * rule-9.15 baseline of one item per slot and applying any
 * {@link ItemSlotModifierEffect}s carried by borne items. Modifiers gated by
 * `requiresNaturalSkill` apply only when `naturalSkills` includes that skill.
 *
 * Also returns the slot-exclusion rules (e.g. Swordmaster's "two weapons
 * means no shield") so the caller can drop the excluded slot once the extra
 * capacity is actually consumed.
 */
function collectSlotCapacities(
  state: GameState,
  items: readonly CardInstance[],
  naturalSkills: readonly string[],
): { capacity: Map<Keyword, number>; exclusions: { slot: Keyword; excluded: Keyword }[] } {
  const capacity = new Map<Keyword, number>();
  for (const slot of SLOT_KEYWORDS) capacity.set(slot, 1);
  const exclusions: { slot: Keyword; excluded: Keyword }[] = [];

  for (const item of items) {
    const def = resolveDef(state, item.instanceId);
    for (const eff of getCardEffects(def)) {
      if (eff.type !== 'item-slot-modifier') continue;
      if (eff.requiresNaturalSkill && !naturalSkills.includes(eff.requiresNaturalSkill)) continue;
      capacity.set(eff.slot, (capacity.get(eff.slot) ?? 0) + eff.delta);
      if (eff.excludesSlotWhenExtraUsed) {
        exclusions.push({ slot: eff.slot, excluded: eff.excludesSlotWhenExtraUsed });
      }
    }
  }

  return { capacity, exclusions };
}

/**
 * Returns the set of item instance IDs whose **effects** apply on the given
 * character. Non-slotted items are always included. For each slot keyword,
 * items are admitted in carrying order up to the slot's capacity (one by
 * default; see {@link ItemSlotModifierEffect}); items beyond capacity are
 * silenced for effect-collection purposes.
 *
 * `naturalSkills` gates `requiresNaturalSkill` slot modifiers — pass the
 * bearing character's natural (card-definition) skills.
 *
 * Callers should still apply per-item corruption points and marshalling
 * points from every borne item — those are not effects.
 */
export function pickActiveItems(
  state: GameState,
  items: readonly CardInstance[],
  naturalSkills: readonly string[] = [],
): ReadonlySet<string> {
  const { capacity, exclusions } = collectSlotCapacities(state, items, naturalSkills);

  // First pass: admit items up to each slot's capacity (carrying order).
  const active = new Set<string>();
  const used = new Map<Keyword, number>();
  const admittedBySlot = new Map<Keyword, string[]>();
  for (const item of items) {
    const def = resolveDef(state, item.instanceId);
    const slot = getItemSlot(def);
    const id = item.instanceId as string;
    if (slot === null) {
      active.add(id);
      continue;
    }
    const cap = capacity.get(slot) ?? 1;
    const count = used.get(slot) ?? 0;
    if (count >= cap) continue;
    used.set(slot, count + 1);
    active.add(id);
    const list = admittedBySlot.get(slot) ?? [];
    list.push(id);
    admittedBySlot.set(slot, list);
  }

  // Second pass: where a slot consumed extra capacity (more than one item in
  // use), drop the items of any slot it excludes (rule 9.16 trade-off).
  for (const { slot, excluded } of exclusions) {
    if ((used.get(slot) ?? 0) > 1) {
      for (const id of admittedBySlot.get(excluded) ?? []) active.delete(id);
    }
  }

  return active;
}

/**
 * Convenience wrapper: returns the active-item set for a character, passing
 * the character's natural skills so `requiresNaturalSkill` slot modifiers
 * (e.g. Swordmaster's two-weapon privilege for an already-warrior sage) are
 * gated correctly.
 */
export function pickActiveItemsForCharacter(
  state: GameState,
  char: CharacterInPlay,
): ReadonlySet<string> {
  const charDef = resolveDef(state, char.instanceId);
  const naturalSkills = getEffectiveNaturalSkills(
    state,
    char,
    charDef && 'skills' in charDef ? (charDef as { readonly skills?: readonly string[] }) : undefined,
  );
  return pickActiveItems(state, char.items, naturalSkills);
}
