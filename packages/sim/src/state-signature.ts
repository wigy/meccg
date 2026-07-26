/**
 * @module state-signature
 *
 * Coarse, cheap signature of a projected {@link PlayerView} used to detect
 * game-state cycles.
 *
 * Some cards make a no-op loop legal: *I'll Report You* (le-196) says "you
 * may return this card to your hand during any organization phase" with no
 * cost, so a deterministic policy can play it, return it, and replay it
 * forever — observed burning a full 25,000-decision budget in one turn
 * during bc-vs-bc benchmarks, and capable of hanging a human's lobby game
 * against the AI.
 *
 * The signature deliberately tracks *quantities that any real progress
 * changes* (zone sizes, marshalling points, tap counts, phase/turn) rather
 * than card identities. Legitimately repeated actions — drawing one card at
 * a time, playing several items — move at least one of these, so they never
 * collide; a true cycle returns to the identical signature.
 */

import type { PlayerView } from '@meccg/shared';
import { CardStatus } from '@meccg/shared';

/** Sums a marshalling-point breakdown. */
function mpTotal(points: { readonly character: number; readonly item: number; readonly faction: number; readonly ally: number; readonly kill: number; readonly misc: number }): number {
  return points.character + points.item + points.faction + points.ally + points.kill + points.misc;
}

/**
 * Builds the cycle-detection signature of a view. Cheap enough to call on
 * every decision (a handful of length reads and one join).
 */
export function viewSignature(view: PlayerView): string {
  const s = view.self;
  const o = view.opponent;
  // Tapped characters count: a cycle that taps something to pay a cost is
  // progress, and this is what distinguishes it from a free no-op loop.
  let selfTapped = 0;
  for (const character of Object.values(s.characters)) {
    if (character.status !== CardStatus.Untapped) selfTapped++;
  }
  return [
    view.turnNumber,
    view.phaseState.phase,
    (view.phaseState as { setupStep?: { step: string } }).setupStep?.step ?? '',
    view.activePlayer ?? '',
    s.hand.length, s.playDeck.length, s.discardPile.length, s.cardsInPlay.length,
    s.siteDeck.length, s.killPile.length, s.outOfPlayPile.length,
    s.companies.length, Object.keys(s.characters).length, selfTapped,
    s.generalInfluenceUsed, mpTotal(s.marshallingPoints),
    o.hand.length, o.playDeck.length, o.discardPile.length, o.cardsInPlay.length,
    o.companies.length, Object.keys(o.characters).length, mpTotal(o.marshallingPoints),
    view.combat === null ? 0 : 1, view.chain === null ? 0 : 1,
    view.pendingEffects.length,
  ].join('|');
}
