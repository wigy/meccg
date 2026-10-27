/**
 * @module ai/h2/services/company-boost
 *
 * Reading a `company-combat-boost` short event off the card that would be
 * played, in the one shape this design can price exactly.
 *
 * Two modules need the same answer about this family, for opposite reasons.
 * `combat` prices the plain form in an attack window — the same attack, faced
 * by a company whose matching characters fight at the boosted prowess — and
 * `events` must decline exactly that form, so which of them scores a boost is
 * stated in both modules rather than decided by the order the registry happens
 * to list them in (`--modules events,combat` reverses it). Neither may import
 * the other, and a private copy of the reader in each would be two opinions
 * about one declared effect list, which is what this layer exists to prevent.
 *
 * Only the plain form is read: a prowess bonus, optionally gated on the
 * character's race (`filter: { target.race }`), with an accompanying body
 * modifier tolerated and left to the caller to state as unmodelled. Every
 * variant carrying a corruption-check cost, an item or skill requirement, an
 * attack `when` or a single-target scope reads as null and stays exactly as
 * unowned as it was — Wizard's Fire, Some Secret Art of Flame, Alert the Folk,
 * Biter and Beater!, Foe Dismayed and Staff Asunder among them. Of the nine
 * cards in the pool that declare the effect, one reads plain: The Dwarves Are
 * upon You! (dm-124).
 */

import type { CardDefinition, CardInstanceId, GameAction, PlayerView } from '@meccg/shared';

/** A `company-combat-boost` in the shape this reads, as declared by the card. */
export interface PlainCompanyBoost {
  /** The card's printed name, for a rationale. */
  readonly name: string;
  /** Total prowess the effects add to each boosted character. */
  readonly prowess: number;
  /** The race `filter: { target.race }` names, or undefined for every character. */
  readonly race?: string;
}

/**
 * Keys a boost effect may carry and still be the plain form.
 *
 * Anything else — a cost, a requirement, a `when`, a narrowed scope — is a
 * condition this cannot check, and an unchecked condition must never be
 * assumed to hold: the card would then be priced for a boost the engine will
 * not apply.
 */
const PLAIN_KEYS = new Set(['type', 'stat', 'value', 'filter']);

/**
 * The boost a `play-short-event` action would apply, or null when the card is
 * not of this family or declares a shape this cannot price exactly.
 *
 * The card is looked up in hand, which is where a short event is played from;
 * an action naming something else reads as null rather than throwing, because
 * an ownership gate runs on every candidate a decision offers.
 */
export function plainCompanyBoostOf(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  action: GameAction,
): PlainCompanyBoost | null {
  const cardInstanceId = (action as unknown as { cardInstanceId?: CardInstanceId }).cardInstanceId;
  const card = cardInstanceId ? view.self.hand.find(c => c.instanceId === cardInstanceId) : undefined;
  if (!card) return null;
  const def = cardPool[card.definitionId] as unknown as {
    name?: string; effects?: readonly Record<string, unknown>[];
  } | undefined;
  const boosts = (def?.effects ?? []).filter(e => e.type === 'company-combat-boost');
  if (boosts.length === 0) return null;
  let prowess = 0;
  let race: string | undefined;
  for (const effect of boosts) {
    if (Object.keys(effect).some(key => !PLAIN_KEYS.has(key))) return null;
    const filter = effect.filter as Record<string, unknown> | undefined;
    if (filter !== undefined) {
      const keys = Object.keys(filter);
      if (keys.length !== 1 || keys[0] !== 'target.race' || typeof filter['target.race'] !== 'string') return null;
      if (race !== undefined && race !== filter['target.race']) return null;
      race = filter['target.race'];
    }
    if (effect.stat === 'prowess' && typeof effect.value === 'number') prowess += effect.value;
    else if (effect.stat !== 'body') return null;
  }
  if (prowess <= 0) return null;
  return { name: def?.name ?? card.definitionId, prowess, race };
}
