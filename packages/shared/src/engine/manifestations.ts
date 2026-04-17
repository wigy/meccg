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
  CardInstance,
  DragonAtHomeEffect,
  GameState,
  HazardEventCard,
  ManifestId,
  PlayerState,
  SiteCard,
} from '../index.js';
import { ownerOf } from '../types/state.js';

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
 * The off-board piles consulted to detect "this manifestation is gone".
 * Eliminated pile and kill pile both indicate "the chain is broken";
 * discard pile too because cards discarded by an effect (rather than
 * defeated) still trigger the cascade per METD §4.2.
 */
function chainCardInPile(state: GameState, m: ManifestId, pile: readonly CardInstance[]): boolean {
  for (const card of pile) {
    const def = state.cardPool[card.definitionId as string];
    if (manifestIdOf(def) === m) return true;
  }
  return false;
}

/**
 * Returns true iff any card from the chain identified by `m` has left
 * play in any way — defeated (`killPile`), eliminated (`outOfPlayPile`),
 * or discarded (`discardPile`). Per METD §4.2 any of these triggers the
 * cascade and blocks further plays of the chain.
 *
 * The scan is O(total off-board pile size) with a tag check.
 */
export function isManifestationDefeated(state: GameState, m: ManifestId): boolean {
  for (const player of state.players) {
    if (chainCardInPile(state, m, player.outOfPlayPile)) return true;
    if (chainCardInPile(state, m, player.killPile)) return true;
    if (chainCardInPile(state, m, player.discardPile)) return true;
  }
  return false;
}

/**
 * Defeat-cascade pass (METD §4.2). When any manifestation card lands in
 * an off-board pile (kill / out-of-play / discard), every sister card of
 * the same chain that is still in play is swept into the **owning
 * player's** `outOfPlayPile`. This blocks further plays of the chain
 * (via {@link isManifestationDefeated}) and removes lair augmentations
 * (because no `dragon-at-home` permanent-event remains in `cardsInPlay`).
 *
 * The pass is idempotent — running it twice is a no-op once the cascade
 * is fully resolved. Owner is derived from the instance ID prefix via
 * {@link ownerOf}, so cross-player sweeps land in the correct
 * player's pile (preserving the no-card-disappears invariant and the
 * §4.1 MP attribution rule).
 */
export function applyManifestationCascade(state: GameState): GameState {
  // Identify every chain that has any off-board card.
  const removed = new Set<string>();
  for (const player of state.players) {
    for (const pile of [player.outOfPlayPile, player.killPile, player.discardPile]) {
      for (const card of pile) {
        const def = state.cardPool[card.definitionId as string];
        const m = manifestIdOf(def);
        if (m) removed.add(m as string);
      }
    }
  }
  if (removed.size === 0) return state;

  // Sweep in-play sister cards. Each gets routed to its owner's
  // outOfPlayPile based on the instance ID prefix.
  const players = state.players.map(p => ({ ...p, cardsInPlay: [...p.cardsInPlay], characters: { ...p.characters } }));
  const additions: Record<string, CardInstance[]> = {};
  let changed = false;
  for (let pi = 0; pi < players.length; pi++) {
    const p = players[pi];
    const keep: typeof p.cardsInPlay = [];
    for (const card of p.cardsInPlay) {
      const def = state.cardPool[card.definitionId as string];
      const m = manifestIdOf(def);
      if (m && removed.has(m as string)) {
        const owner = ownerOf(card.instanceId) as string;
        (additions[owner] ??= []).push({ instanceId: card.instanceId, definitionId: card.definitionId });
        changed = true;
      } else {
        keep.push(card);
      }
    }
    p.cardsInPlay = keep;
  }
  if (!changed) return state;
  // Apply additions to the matching player's outOfPlayPile.
  const finalPlayers = players.map(p => {
    const adds = additions[p.id as string];
    if (!adds || adds.length === 0) return p;
    return { ...p, outOfPlayPile: [...p.outOfPlayPile, ...adds] };
  }) as unknown as readonly [PlayerState, PlayerState];
  return { ...state, players: finalPlayers };
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
