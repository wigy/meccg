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
 * - **The price of the hazard limit itself.** Re-running the allocation with
 *   every limit halved says what the limit is worth, which is what the hazard
 *   player pays for touching their sideboard during untap (CoE 2.I). See
 *   {@link HazardPlan.harmIfLimitsHalved}.
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
  /**
   * What a creature *not yet held* would add, if it arrived.
   *
   * The question a fetch asks: this card is on offer, is it worth taking? It is
   * the same marginal the plan pays its own cards, computed for a definition
   * against the best target with a slot left — so a creature that duplicates
   * what the plan already does is correctly worth less than one that opens a
   * company nothing is aimed at.
   */
  marginalFor(definitionId: string): number;
  /** Total TSD the plan expects to deny if it is carried out. */
  readonly totalHarm: number;
  /**
   * What the plan is worth if every hazard limit is halved.
   *
   * The hazard player who touches their sideboard during untap pays for it with
   * exactly that: `snapshotHazardLimit` halves the limit, rounding up, for every
   * company in the coming movement/hazard phase. The difference against
   * {@link totalHarm} is what the access costs, in the same currency as
   * everything else the plan says.
   *
   * Computed on demand and cached, because this is the most expensive service in
   * the project and only one decision a turn ever asks.
   */
  harmIfLimitsHalved(): number;
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

  /**
   * The companies the plan may spend against, with `slots` set by `limitOf`.
   *
   * A factory rather than a value because a `Target` carries the allocation's
   * mutable state, so answering "what if the limits were halved?" needs a fresh
   * set rather than a second pass over the same one.
   */
  const makeTargets = (limitOf: (baseLimit: number) => number): Target[] =>
    view.opponent.companies.map(company => {
      const denial = denialContext(view, company, beliefs, standing, tunables);
      // The engine's snapshot when there is one; otherwise the limit the coming
      // reveal will set. Outside the movement/hazard phase it is not yet fixed,
      // and reading the zero it reports as "nothing may be spent here" would
      // price every hazard in hand at nothing all through the organization
      // phase. `snapshotHazardLimit` floors the base limit at 2, so a company
      // of one still invites two hazards and predicting its own size understates
      // the plan.
      const published = exposure.hazardLimit(company.id) ?? 0;
      const base = published > 0 ? published : Math.max(company.characters.length, 2);
      return {
        companyId: company.id as string,
        label: `${company.characters.length}-character company`,
        roster: rosterOf(company, view.opponent.characters, cardPool),
        price: denialPricer(cardPool, standing, tunables, denial),
        assigned: [],
        slots: limitOf(base),
        harm: 0,
      };
    });

  /**
   * Greedy allocation of the hazards in hand across the companies.
   *
   * Repeatedly takes the (card, company) pair that adds the most, given what
   * that company already has. Supermodularity is why the choice is re-made every
   * round rather than sorted once — a card worth nothing against a fresh company
   * can be worth a lot behind another one.
   */
  const allocate = (targets: readonly Target[]): Map<string, HazardAssignment> => {
    const assigned = new Map<string, HazardAssignment>();
    const unassigned = new Set(hazards.map(h => h.instanceId as string));
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
      assigned.set(best.hazard.instanceId as string, {
        instanceId: best.hazard.instanceId,
        name: best.hazard.name,
        targetCompanyId: best.target.companyId,
        targetLabel: best.target.label,
        marginal: best.marginal,
        order: best.target.assigned.length,
      });
    }
    return assigned;
  };

  const targets = makeTargets(base => base);
  const assignments = allocate(targets);

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
  /** The halved-limit total, computed at most once — see `harmIfLimitsHalved`. */
  let halvedHarm: number | null = null;
  return {
    assignments: ordered,
    totalHarm: targets.reduce((sum, target) => sum + target.harm, 0),
    worth: (instanceId: CardInstanceId) => assignments.get(instanceId as string) ?? null,

    harmIfLimitsHalved(): number {
      if (halvedHarm !== null) return halvedHarm;
      // `snapshotHazardLimit` rounds the halving *up*, so a limit of 3 becomes
      // 2 rather than 1. Mirrored rather than approximated: the whole cost of
      // touching the sideboard is this number.
      const halved = makeTargets(base => Math.ceil(base / 2));
      allocate(halved);
      halvedHarm = halved.reduce((sum, target) => sum + target.harm, 0);
      return halvedHarm;
    },

    marginalFor(definitionId: string): number {
      const candidate = hazardOf(
        cardPool, 'hypothetical' as CardInstanceId, definitionId, killTsdOf,
      );
      if (!candidate) return 0;
      let best = 0;
      for (const target of targets) {
        if (target.slots <= 0 || target.roster.length === 0) continue;
        const marginal = harmOf(target, cardPool, [...target.assigned, candidate], tunables) - target.harm;
        if (marginal > best) best = marginal;
      }
      return best;
    },
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
