/**
 * @module manifestations
 *
 * Manifestation-chain state derivation for the Dragons expansion (and any
 * future multi-form entity such as Aragorn or Gollum manifestations).
 *
 * A **manifestation chain** is a set of cards that together represent
 * multiple in-game forms of one entity — for Dragons, the basic creature
 * (e.g. Smaug), the Ahunt long-event, and the At-Home permanent-event.
 * Every card in one chain carries the same {@link ManifestId} (by
 * convention the basic form's definition id).
 *
 * Chain-level state is derived from the eliminated pile, not stored
 * separately. Rationale: a second source of truth would be easy to drift
 * from pile contents; deriving keeps the no-card-disappears invariant
 * load-bearing (see `feedback_no_card_disappears`). See the expansion plan
 * §4.3 for the design discussion.
 */

import type {
  AutomaticAttack,
  CardDefinition,
  GameState,
  ManifestId,
  SiteCard,
} from '../index.js';

/**
 * Extracts a card definition's {@link ManifestId} if it has one.
 * Returns `undefined` for cards that are not part of any manifestation
 * chain (every non-Dragon card today, and most future cards).
 */
export function manifestIdOf(def: CardDefinition | undefined): ManifestId | undefined {
  if (!def) return undefined;
  return (def as { manifestId?: ManifestId }).manifestId;
}

/**
 * Returns true iff any manifestation of the chain identified by `m` has
 * been defeated/removed — i.e. sits in either player's eliminated pile.
 *
 * Per the defeat cascade (expansion plan §4.2), when one manifestation is
 * defeated all sister manifestations are swept into the eliminated pile
 * too, so this predicate simultaneously answers:
 *   - is the chain blocked from further play?
 *   - does the Dragon's lair still have its automatic-attack?
 *
 * The scan is O(total eliminated-pile size) with a tag check — cheap in
 * practice because eliminated piles are small.
 */
export function isManifestationDefeated(state: GameState, m: ManifestId): boolean {
  for (const player of state.players) {
    for (const card of player.outOfPlayPile) {
      const def = state.cardPool[card.definitionId as string];
      if (manifestIdOf(def) === m) return true;
    }
  }
  return false;
}

/**
 * Returns a site's automatic-attacks filtered for the current game state.
 *
 * Today this only suppresses Dragon auto-attacks at a lair whose resident
 * Dragon is defeated. Callers in reducer-site / legal-actions should use
 * this instead of reading `siteDef.automaticAttacks` directly so any
 * future runtime-gated auto-attacks (e.g. At-Home augmentations) can be
 * added in one place.
 */
export function getActiveAutoAttacks(
  state: GameState,
  siteDef: SiteCard,
): readonly AutomaticAttack[] {
  const lairOf = (siteDef as { lairOf?: ManifestId }).lairOf;
  if (!lairOf || !isManifestationDefeated(state, lairOf)) {
    return siteDef.automaticAttacks;
  }
  // Dragon defeated → strip its (Dragon-typed) automatic-attacks. Other
  // attacks on the same site (rare, but possible via future "additional
  // attack" effects) are left intact.
  return siteDef.automaticAttacks.filter(a => a.creatureType !== 'Dragon');
}
