/**
 * @module effects/play-flags
 *
 * Central helper for the closed {@link PlayFlag} enum. The engine
 * consults these flags at card-play time to gate uniform behaviors
 * (home-site-only character placement, playable-as-resource hazard
 * cancellation, hazard-limit bypass). Keeping the lookup in one place
 * removes the scattered `effects.some(e => e.type === 'play-restriction'
 * && e.rule === 'X')` checks that used to carry per-card string
 * literals through the reducer and legal-action computers.
 */

import type { CardEffect, PlayFlag } from '../types/effects.js';
import type { CardInPlay } from '../types/state-cards.js';

/**
 * Returns true if the card definition declares the given play-flag.
 *
 * The effect's optional `when` condition is intentionally ignored:
 * current engine flows never carry the context needed to evaluate it
 * (e.g. `home-site-only` is checked during play-character from hand,
 * where the reason is always `play-character`). The declarative
 * `when` on Frodo's flag — `{ $not: { reason: 'starting-character' } }`
 * — still documents the intent for when the rule moves into a
 * condition-aware path.
 */
export function hasPlayFlag(
  def: { readonly effects?: readonly CardEffect[] } | undefined,
  flag: PlayFlag,
): boolean {
  if (!def?.effects) return false;
  return def.effects.some(e => e.type === 'play-flag' && e.flag === flag);
}

/**
 * Returns true if any attached hazard on a character carries the
 * `no-direct-influence` play-flag.
 */
export function hasNoDirectInfluenceRestriction(
  hazards: readonly CardInPlay[],
  cardPool: Readonly<Record<string, unknown>>,
): boolean {
  return hazards.some(h => {
    const def = cardPool[h.definitionId as string] as { readonly effects?: readonly CardEffect[] } | undefined;
    return hasPlayFlag(def, 'no-direct-influence');
  });
}

/**
 * Returns true if any item attached to a character carries the
 * `grants-followers` play-flag. Used to override the Balrog's default
 * "may not have any followers" restriction (ba-3, enforced via
 * `isBalrogAvatarDef`) when a Demon fána card such as Great Shadow
 * (ba-62) is attached: "The Balrog gains ... and may have followers."
 */
export function hasFollowerGrantPermission(
  items: readonly CardInPlay[],
  cardPool: Readonly<Record<string, unknown>>,
): boolean {
  return items.some(item => {
    const def = cardPool[item.definitionId as string] as { readonly effects?: readonly CardEffect[] } | undefined;
    return hasPlayFlag(def, 'grants-followers');
  });
}
