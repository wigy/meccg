/**
 * @module ai/h2/services/hazard-plan
 *
 * A standing answer to "what is each hazard in my hand for?"
 *
 * `card-price` priced a creature by what it would deny **alone**, against the
 * opponent's largest company, and the module doc admitted what that costs: the
 * Orc-lieutenant came out at zero because the company could beat it, while
 * `hazards` ranked *playing* it at +3.9% as the opener of a bundle the warband
 * finished. Both were right about different questions, but the value of keeping
 * a card is much closer to its contribution to a plan than to its solo worth.
 *
 * So this service builds the plan: a **preliminary assignment** of every hazard
 * creature in hand to a company it would be played against, respecting each
 * company's hazard limit, and priced with the same degradation `hazards` uses —
 * the second creature aimed at a company meets the company the first one left
 * behind.
 *
 * Two things fall out of it, which is why it is a service and not a module:
 *
 * - **A card price.** What a hazard is worth keeping is what it contributes to
 *   the plan: the harm the plan does with it, minus the harm the plan does
 *   without it. A creature the plan cannot use is worth nothing to hold, and a
 *   creature that only works as a follow-up is credited for being one.
 * - **A target.** The assignment itself is worth printing. A hand of hazards
 *   with no company to aim them at is a different position from one where every
 *   card has a job, and until now nothing in the output could tell them apart.
 *
 * The allocation is **greedy and says so**: at each step it takes the
 * (card, company) pair adding the most harm, given what that company has
 * already been assigned. Assignment under a supermodular value function is a
 * knapsack per company and an allocation across them; `hazards` beam-searches
 * the first at decision time, and this is deliberately the cheaper answer,
 * because it is consulted for a price rather than for a move.
 */

import type { CardDefinition, CardInstanceId, PlayerView } from '@meccg/shared';
import type { Tunables } from '../core/tunables.js';
import type { Standing } from '../core/types.js';
import { memoizeOnFirst } from '../core/memo.js';
import { computeBeliefs } from './beliefs.js';
import { denialContext, denialPricer } from './denial.js';
import { computeExposure } from './exposure.js';
import { rosterOf } from './strike/prowess.js';
import type { StrikeTarget } from './strike/prowess.js';
import type { AttackProfile, SequencePricer } from './strike/sequence.js';
import { resolveAttacks } from './strike/sequence.js';

/** What one hazard in hand is for. */
export interface HazardAssignment {
  /** The hand card. */
  readonly instanceId: CardInstanceId;
  /** Its printed name. */
  readonly name: string;
  /** The company it would be played against, or null when the plan has no use for it. */
  readonly targetCompanyId: string | null;
  /** What that company is, for the reader. */
  readonly targetLabel: string;
  /** TSD the plan gains by including this card, over the plan without it. */
  readonly marginal: number;
  /** Where in that company's sequence it would be played, from 1. */
  readonly order: number;
}

/** The plan, and the prices that come out of it. */
export interface HazardPlan {
  /** Every hazard creature in hand, best-assigned first. */
  readonly assignments: readonly HazardAssignment[];
  /** What keeping one card is worth, or null when it is not a hazard in hand. */
  worth(instanceId: CardInstanceId): HazardAssignment | null;
  /** Total TSD the plan expects to deny if it is carried out. */
  readonly totalHarm: number;
}

/** A creature in hand, with the attack it would make. */
interface Hazard {
  readonly instanceId: CardInstanceId;
  readonly name: string;
  readonly profile: AttackProfile;
  readonly killMp: number;
}

/** What one opposing company can be spent against, and by whom. */
interface Target {
  readonly companyId: string;
  readonly label: string;
  readonly roster: readonly StrikeTarget[];
  readonly price: SequencePricer;
  /** Hazards the plan has already aimed here, in order. */
  readonly assigned: Hazard[];
  /** Slots left in the hazard limit. */
  slots: number;
  /** Harm the assigned sequence is expected to do. */
  harm: number;
}

/** Read a creature card out of hand, or null when the card is not one. */
function hazardOf(
  cardPool: Readonly<Record<string, CardDefinition>>,
  instanceId: CardInstanceId,
  definitionId: string,
  killTsdOf: (killMp: number) => number,
): Hazard | null {
  const def = cardPool[definitionId] as unknown as {
    cardType?: string; name?: string; strikes?: number; prowess?: number;
    body?: number | null; killMarshallingPoints?: number;
  } | undefined;
  if (!def || def.cardType !== 'hazard-creature') return null;
  const killMp = def.killMarshallingPoints ?? 0;
  const name = def.name ?? definitionId;
  return {
    instanceId,
    name,
    killMp,
    profile: {
      strikeProwess: def.prowess ?? 0,
      strikes: def.strikes ?? 1,
      creatureBody: def.body ?? null,
      detainment: false,
      bodyCheckModifier: 0,
      killTsd: killTsdOf(killMp),
      killLabel: `${name} beaten — ${killMp} kill MP to the defender`,
      name,
    },
  };
}

/** Expected harm of playing a sequence of hazards into one company. */
function harmOf(
  target: Target,
  cardPool: Readonly<Record<string, CardDefinition>>,
  sequence: readonly Hazard[],
  tunables: Tunables,
): number {
  if (sequence.length === 0) return 0;
  const result = resolveAttacks(
    target.roster, cardPool, sequence.map(h => h.profile), target.price,
    { maxStates: tunables.attackStateCap },
  );
  const expected = result.outcomes.reduce((sum, o) => sum + o.p * o.dtsd, 0);
  // Each hazard costs a card out of hand whatever it achieves, exactly as the
  // bundle planner charges.
  return expected - tunables.provisionalCardPrice * sequence.length;
}

/** Build the plan for a position. */
function buildHazardPlan(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  standing: Standing,
  tunables: Tunables,
): HazardPlan {
  const killTsdOf = (killMp: number): number =>
    (killMp > 0 ? standing.tsdAfter({}, { kill: killMp }) - standing.tsd : 0);

  const hazards: Hazard[] = [];
  for (const card of view.self.hand) {
    const hazard = hazardOf(cardPool, card.instanceId, card.definitionId as string, killTsdOf);
    if (hazard) hazards.push(hazard);
  }

  const beliefs = computeBeliefs(view, cardPool);
  const exposure = computeExposure(view, cardPool);
  const targets: Target[] = view.opponent.companies.map(company => {
    const denial = denialContext(view, company, beliefs, standing, tunables);
    // The engine's snapshot when there is one; the company's own size otherwise.
    // Outside the movement/hazard phase the limit is not yet fixed, and reading
    // the zero it reports as "nothing may be spent here" would price every
    // hazard in hand at nothing all through the organization phase.
    const published = exposure.hazardLimit(company.id) ?? 0;
    return {
      companyId: company.id as string,
      label: `${company.characters.length}-character company`,
      roster: rosterOf(company, view.opponent.characters, cardPool),
      price: denialPricer(cardPool, standing, tunables, denial),
      assigned: [],
      slots: published > 0 ? published : company.characters.length,
      harm: 0,
    };
  });

  const assignments = new Map<string, HazardAssignment>();
  const unassigned = new Set(hazards.map(h => h.instanceId as string));

  // Greedy: repeatedly take the (card, company) pair that adds the most, given
  // what that company already has. Supermodularity is why the choice is
  // re-made every round rather than sorted once — a card worth nothing against
  // a fresh company can be worth a lot behind another one.
  for (;;) {
    let best: { hazard: Hazard; target: Target; marginal: number } | null = null;
    for (const target of targets) {
      if (target.slots <= 0 || target.roster.length === 0) continue;
      for (const hazard of hazards) {
        if (!unassigned.has(hazard.instanceId as string)) continue;
        const marginal = harmOf(target, cardPool, [...target.assigned, hazard], tunables) - target.harm;
        if (!best || marginal > best.marginal) best = { hazard, target, marginal };
      }
    }
    if (!best || best.marginal <= 0) break;
    best.target.assigned.push(best.hazard);
    best.target.harm += best.marginal;
    best.target.slots--;
    unassigned.delete(best.hazard.instanceId as string);
    assignments.set(best.hazard.instanceId as string, {
      instanceId: best.hazard.instanceId,
      name: best.hazard.name,
      targetCompanyId: best.target.companyId,
      targetLabel: best.target.label,
      marginal: best.marginal,
      order: best.target.assigned.length,
    });
  }

  // Everything the plan could not use. Worth nothing to keep *as an attack* —
  // which is a real statement about the hand, not a failure to price it.
  for (const hazard of hazards) {
    if (assignments.has(hazard.instanceId as string)) continue;
    assignments.set(hazard.instanceId as string, {
      instanceId: hazard.instanceId,
      name: hazard.name,
      targetCompanyId: null,
      targetLabel: targets.length === 0
        ? 'no company to aim it at'
        : 'nothing left it improves',
      marginal: 0,
      order: 0,
    });
  }

  const ordered = [...assignments.values()].sort((a, b) => b.marginal - a.marginal);
  return {
    assignments: ordered,
    totalHarm: targets.reduce((sum, target) => sum + target.harm, 0),
    worth: (instanceId: CardInstanceId) => assignments.get(instanceId as string) ?? null,
  };
}

/**
 * Build the plan, once per position.
 *
 * It resolves an attack sequence per (card, company) pair per round, so it is
 * among the most expensive things in the project — and it is consulted from
 * `card-price`, which every discard decision reaches. See `core/memo`.
 */
export const computeHazardPlan = memoizeOnFirst(buildHazardPlan);
