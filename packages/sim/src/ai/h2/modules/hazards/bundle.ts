/**
 * @module ai/h2/modules/hazards/bundle
 *
 * Choosing *which creatures to play together*, which is the decision §3.4 says
 * hazard play actually is.
 *
 * Scoring each creature on its own and playing the best one is how a hazard
 * player ends up dribbling one attack per turn into a company that shrugs each
 * one off. Value here is supermodular: the second creature meets a company that
 * the first one already tapped, wounded or shortened, and every one of those
 * modifiers is in the strike enumeration already. So a bundle is scored by
 * resolving its attacks *in sequence* against one roster, and the interaction
 * term arrives for free.
 *
 * The search is a beam rather than an enumeration. Subsets are exponential and
 * this runs in mass self-play, so bundles are grown one creature at a time and
 * only the best `hazardBeamWidth` survive each round. That is a real limit and
 * it is reported: `truncated` says the space was cut, and the module prints the
 * width, so nobody reads a ranked list as if it were exhaustive.
 *
 * What bounds the bundle is the hazard limit — `effectiveHazardLimit`, fixed
 * when the company revealed its movement and modifiable afterwards — minus what
 * has already been played into this company. That makes this a knapsack with a
 * supermodular value function, and the beam is the admission that such a
 * knapsack has no cheap exact answer.
 */

import type { CardDefinition } from '@meccg/shared';
import type { Outcome } from '../../core/types.js';
import type { Tunables } from '../../core/tunables.js';
import type { Standing } from '../../services/standing.js';
import type { StrikeTarget } from '../../services/strike/prowess.js';
import type { AttackProfile, SequencePricer } from '../../services/strike/sequence.js';
import { resolveAttacks } from '../../services/strike/sequence.js';

/** One hazard card that could be played, with the attack it would make. */
export interface Candidate {
  /** The hand card. */
  readonly instanceId: string;
  /** Its printed name, for every label a reader sees. */
  readonly name: string;
  /** The attack it makes against the target company. */
  readonly profile: AttackProfile;
  /** Kill marshalling points the defender collects for beating it. */
  readonly killMp: number;
}

/** A planned sequence of hazards against one company, with what it is worth. */
export interface Bundle {
  /** The cards, in the order they would be played. */
  readonly cards: readonly Candidate[];
  /** The outcome distribution of the whole sequence. */
  readonly outcomes: readonly Outcome[];
  /** Expected change in TSD, from the hazard player's seat. */
  readonly expectedTsd: number;
  /** Utility in win probability, integrated over the outcomes. */
  readonly utility: number;
  /** True when the strike enumeration merged states to stay inside its cap. */
  readonly merged: boolean;
}

/** What the search was allowed to look at, so a caller can say so. */
export interface BundleSearch {
  /** Bundles that survived, best first. */
  readonly bundles: readonly Bundle[];
  /** Slots left in the hazard limit for this company. */
  readonly slots: number;
  /** True when the beam or the length cap discarded live candidates. */
  readonly truncated: boolean;
}

/** Score one ordered sequence of candidates against the roster. */
function scoreBundle(
  cards: readonly Candidate[],
  roster: readonly StrikeTarget[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  price: SequencePricer,
  standing: Standing,
  tunables: Tunables,
): Bundle {
  const result = resolveAttacks(
    roster,
    cardPool,
    cards.map(c => c.profile),
    price,
    { maxStates: tunables.attackStateCap },
  );
  // Every hazard costs a card out of hand, whatever it achieves.
  const cardPrice = tunables.provisionalCardPrice * cards.length;
  const outcomes: Outcome[] = result.outcomes.map(o => ({ ...o, dtsd: o.dtsd - cardPrice }));
  const scored = standing.score(outcomes);
  return {
    cards,
    outcomes,
    expectedTsd: scored.expectedTsd,
    utility: scored.utility,
    merged: result.merged,
  };
}

/**
 * Grow bundles one creature at a time, keeping the best `hazardBeamWidth`.
 *
 * Ordering within a bundle is left as the order the beam found, not optimised
 * separately. The enumeration is order-sensitive — a high-prowess creature
 * played first taps the good parriers for the one that follows — so this is a
 * declared limitation rather than an oversight, and a wider beam explores more
 * of it because each extension is tried against every surviving prefix.
 */
export function planBundles(
  candidates: readonly Candidate[],
  roster: readonly StrikeTarget[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  price: SequencePricer,
  standing: Standing,
  tunables: Tunables,
  slots: number,
): BundleSearch {
  const maxLength = Math.max(0, Math.min(slots, tunables.hazardMaxBundle, candidates.length));
  if (maxLength === 0 || candidates.length === 0) {
    return { bundles: [], slots, truncated: false };
  }

  let truncated = maxLength < Math.min(slots, candidates.length);
  const all: Bundle[] = [];
  let beam: Bundle[] = [];

  for (let length = 1; length <= maxLength; length++) {
    const grown: Bundle[] = [];
    const prefixes: (readonly Candidate[])[] = length === 1 ? [[]] : beam.map(b => b.cards);
    for (const prefix of prefixes) {
      const used = new Set(prefix.map(c => c.instanceId));
      for (const candidate of candidates) {
        if (used.has(candidate.instanceId)) continue;
        grown.push(scoreBundle([...prefix, candidate], roster, cardPool, price, standing, tunables));
      }
    }
    if (grown.length === 0) break;
    grown.sort((a, b) => b.utility - a.utility);
    all.push(...grown);
    if (grown.length > tunables.hazardBeamWidth) truncated = true;
    beam = grown.slice(0, tunables.hazardBeamWidth);
  }

  all.sort((a, b) => b.utility - a.utility);
  return { bundles: all, slots, truncated };
}

/** The best bundle whose first card is a given candidate, or null. */
export function bestBundleStartingWith(
  search: BundleSearch,
  instanceId: string,
): Bundle | null {
  return search.bundles.find(b => b.cards[0]?.instanceId === instanceId) ?? null;
}
