/**
 * @module ai/h2/services/beliefs
 *
 * The belief half of `exposure` (§3.6): what is the opponent holding?
 *
 * Every module that wants to price danger rather than distance needs this.
 * `travel` charges a site path by its length because it cannot ask what is
 * likely to be waiting on it; `hazards` cannot exist at all without it, since
 * a bundle is chosen against what the *other* player can answer with.
 *
 * The hard constraint is the one that shapes the whole design: a module sees
 * only the projected `PlayerView`, so the opponent's deck list is not
 * available. `search/determinize.ts` may read it because the harness hands it
 * the deck catalogue; a module may not, and cheating here would make every
 * number downstream meaningless.
 *
 * What *is* public is what they have shown. The discard pile, the kill pile,
 * the out-of-play pile and everything in play are all visible, and a discard
 * pile in particular is a fair sample of what a player has drawn: cards reach
 * it by being played or discarded, not by being selected for it. So the
 * estimate here is an empirical one — the composition of what they have shown
 * is the best available estimate of the composition of what they still hold —
 * shrunk toward a prior while the sample is small.
 *
 * That is deliberately weaker than knowing the deck, and it is measurable in
 * exactly the way §3.6 asks: predict the kind of a face-down card, then score
 * the prediction against what is revealed. `beliefs.test.ts` pins the
 * mechanics; scoring against revealed on-guard cards across the replay corpus
 * is the validation this service still needs.
 */

import type { CardDefinition, PlayerView } from '@meccg/shared';

/** The broad kinds a hidden card can be, which is all a consumer needs. */
export type CardKind = 'creature' | 'hazard-event' | 'corruption' | 'resource' | 'character';

/** Every kind, in a stable order for reporting. */
export const CARD_KINDS: readonly CardKind[] = [
  'creature', 'hazard-event', 'corruption', 'resource', 'character',
];

/** What the opponent is believed to be holding. */
export interface Beliefs {
  /** Cards of theirs whose identity is public. */
  readonly observed: number;
  /** Cards in their hand, whose identity is not. */
  readonly handSize: number;
  /** Estimated probability that one unseen card of theirs is of a kind. */
  share(kind: CardKind): number;
  /** Expected number of cards of a kind in their hand. */
  expectedInHand(kind: CardKind): number;
  /** Probability their hand holds at least one card of a kind. */
  holdsAtLeastOne(kind: CardKind): number;
  /** How much of the estimate is evidence rather than prior, in [0, 1]. */
  readonly confidence: number;
}

/**
 * Prior composition, used while the opponent has shown little.
 *
 * A MECCG deck is roughly half hazards, and this is a coarse stand-in for
 * that rather than a measured distribution — it is named here so it is
 * visible, and it matters less the more the opponent has played.
 */
const PRIOR: Readonly<Record<CardKind, number>> = {
  creature: 0.30,
  'hazard-event': 0.15,
  corruption: 0.05,
  resource: 0.40,
  character: 0.10,
};

/**
 * Observations needed before the empirical composition is trusted outright.
 *
 * Shrinkage rather than a threshold: with nothing shown the estimate is the
 * prior, and it moves toward what has actually been seen as evidence
 * accumulates. The half-way point is deliberately early — a dozen cards is
 * enough to tell a hazard-heavy deck from a resource-heavy one, which is the
 * distinction consumers care about.
 */
const EVIDENCE_HALF_LIFE = 12;

/** The kind of a card definition. */
export function kindOf(def: CardDefinition | undefined): CardKind | null {
  if (!def) return null;
  const type = def.cardType;
  if (type === 'hazard-creature') return 'creature';
  if (type === 'hazard-event') return 'hazard-event';
  if (type === 'hazard-corruption') return 'corruption';
  if (type.endsWith('-character')) return 'character';
  if (type.includes('resource')) return 'resource';
  return null;
}

/**
 * Build the belief service from a player view.
 *
 * Only the opponent's *public* zones are read. Their hand and deck are counted
 * but never inspected — the view redacts them, and this service exists to
 * estimate what redaction hides rather than to work around it.
 */
export function computeBeliefs(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): Beliefs {
  const counts: Record<CardKind, number> = {
    creature: 0, 'hazard-event': 0, corruption: 0, resource: 0, character: 0,
  };
  let observed = 0;

  const opponent = view.opponent;
  const publicZones = [
    opponent.discardPile,
    opponent.killPile,
    opponent.outOfPlayPile,
    opponent.cardsInPlay,
  ];
  for (const zone of publicZones) {
    for (const card of zone) {
      const kind = kindOf(cardPool[card.definitionId]);
      if (!kind) continue;
      counts[kind]++;
      observed++;
    }
  }
  // Characters in play are public too, and a company on the board says as much
  // about a deck as a discard pile does.
  counts.character += Object.keys(opponent.characters).length;
  observed += Object.keys(opponent.characters).length;

  // Shrinkage: the estimate is the prior with nothing seen, and approaches the
  // observed composition as evidence accumulates.
  const confidence = observed / (observed + EVIDENCE_HALF_LIFE);
  const handSize = opponent.hand.length;

  const share = (kind: CardKind): number => {
    const empirical = observed === 0 ? PRIOR[kind] : counts[kind] / observed;
    return (1 - confidence) * PRIOR[kind] + confidence * empirical;
  };

  return {
    observed,
    handSize,
    confidence,
    share,
    expectedInHand: (kind: CardKind): number => handSize * share(kind),
    holdsAtLeastOne: (kind: CardKind): number => {
      const p = share(kind);
      if (handSize <= 0 || p <= 0) return 0;
      // Cards are treated as drawn independently. The real draw is without
      // replacement from a deck of dozens, so this slightly overstates the
      // chance for large hands — declared rather than corrected, because the
      // deck size that would correct it is itself only a count on the view.
      return 1 - (1 - p) ** handSize;
    },
  };
}
