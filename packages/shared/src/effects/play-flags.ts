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
