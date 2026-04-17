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
  DragonAtHomeEffect,
  GameState,
  HazardEventCard,
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
 * - If the site is a Dragon lair (`lairOf` set) and that Dragon is
 *   defeated, the site's Dragon-typed printed attacks are suppressed.
 * - Any in-play "At-Home" permanent-event for the same Dragon appends an
 *   additional Dragon attack, *unless* the matching Ahunt long-event is
 *   also in play (the rule's "Unless [Dragon] Ahunt is in play" clause).
 *
 * Callers in reducer-site / legal-actions should always use this instead
 * of reading `siteDef.automaticAttacks` directly, so all manifestation
 * gating lives in one place.
 */
export function getActiveAutoAttacks(
  state: GameState,
  siteDef: SiteCard,
): readonly AutomaticAttack[] {
  const lairOf = (siteDef as { lairOf?: ManifestId }).lairOf;
  if (!lairOf) return siteDef.automaticAttacks;

  let printed: readonly AutomaticAttack[] = siteDef.automaticAttacks;
  if (isManifestationDefeated(state, lairOf)) {
    // Dragon defeated → strip its Dragon-typed printed attacks. Other
    // attacks on the same site (rare) are left intact.
    printed = printed.filter(a => a.creatureType !== 'Dragon');
  }

  // Augment with any in-play At-Home effect for this manifestation,
  // unless the matching Ahunt is also in play.
  if (isAhuntInPlay(state, lairOf)) return printed;
  const augments = collectAtHomeAttacks(state, lairOf);
  return augments.length === 0 ? printed : [...printed, ...augments];
}

/**
 * True iff a long-event sharing the given manifestation id is in play
 * for either player. For Dragon chains this means "the Ahunt is up".
 */
function isAhuntInPlay(state: GameState, m: ManifestId): boolean {
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = state.cardPool[card.definitionId as string];
      if (manifestIdOf(def) !== m) continue;
      if ((def as HazardEventCard | undefined)?.eventType === 'long') return true;
    }
  }
  return false;
}

/**
 * Collects every `dragon-at-home` augmentation attack contributed by
 * in-play permanent-events whose `manifestId` matches.
 */
function collectAtHomeAttacks(state: GameState, m: ManifestId): AutomaticAttack[] {
  const out: AutomaticAttack[] = [];
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = state.cardPool[card.definitionId as string];
      if (manifestIdOf(def) !== m) continue;
      const effects = (def as { effects?: readonly { type: string }[] }).effects;
      if (!effects) continue;
      for (const e of effects) {
        if (e.type === 'dragon-at-home') {
          const attack = (e as DragonAtHomeEffect).attack;
          out.push({
            creatureType: attack.creatureType,
            strikes: attack.strikes,
            prowess: attack.prowess,
          });
        }
      }
    }
  }
  return out;
}
