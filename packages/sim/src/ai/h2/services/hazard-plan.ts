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
import { attackBoostOf, boostForRace, boostInPlay, mergeBoosts } from './attack-modifiers.js';
import type { AttackBoost } from './attack-modifiers.js';

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
  /**
   * True for a support event rather than an attack — a card whose whole value is
   * that it improves the attacks around it (Full of Froth and Rage: "all Spider
   * and Animal attacks receive +2 prowess").
   *
   * Such a card must reach the table *before* the attacks it boosts, which is
   * why it always takes order 1 in its company's sequence and the creatures
   * behind it shift down one.
   */
  readonly support: boolean;
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

/** A creature in hand, with the attack it would make before any boost. */
interface Hazard {
  readonly instanceId: CardInstanceId;
  readonly name: string;
  /** Printed race, which is what a boost is looked up by. */
  readonly race: string | null;
  /** The attack as printed; boosts are applied by {@link profileOf}. */
  readonly base: AttackProfile;
  readonly killMp: number;
}

/**
 * A support event in hand: one whose declared modifier improves the attacks
 * around it rather than attacking itself.
 */
interface Support {
  readonly instanceId: CardInstanceId;
  readonly name: string;
  readonly boost: AttackBoost;
}

/** The attack a creature makes with `boost` in play. */
function profileOf(hazard: Hazard, boost: AttackBoost | null): AttackProfile {
  const added = boostForRace(boost, hazard.race);
  if (added.prowess === 0 && added.strikes === 0) return hazard.base;
  return {
    ...hazard.base,
    strikeProwess: hazard.base.strikeProwess + added.prowess,
    strikes: hazard.base.strikes + added.strikes,
  };
}

/** What one opposing company can be spent against, and by whom. */
interface Target {
  readonly companyId: string;
  readonly label: string;
  readonly roster: readonly StrikeTarget[];
  readonly price: SequencePricer;
  /** Hazards the plan has already aimed here, in order. */
  readonly assigned: Hazard[];
  /** Support events the plan would play here, ahead of the attacks. */
  readonly supports: Support[];
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
    body?: number | null; killMarshallingPoints?: number; race?: string;
  } | undefined;
  if (!def || def.cardType !== 'hazard-creature') return null;
  const killMp = def.killMarshallingPoints ?? 0;
  const name = def.name ?? definitionId;
  return {
    instanceId,
    name,
    killMp,
    race: def.race ?? null,
    base: {
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

/**
 * Read a support event out of hand, or null when the card is not one.
 *
 * Long and permanent hazard events only, and only those whose declared
 * `all-attacks` modifier this can read — the same policy `attack-modifiers`
 * applies everywhere else: a modifier nobody can read must not be credited.
 */
function supportOf(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  instanceId: CardInstanceId,
  definitionId: string,
): Support | null {
  const def = cardPool[definitionId] as unknown as {
    cardType?: string; name?: string; eventType?: string;
  } | undefined;
  if (!def || def.cardType !== 'hazard-event') return null;
  if (def.eventType !== 'long' && def.eventType !== 'permanent') return null;
  const name = def.name ?? definitionId;
  const boost = attackBoostOf(cardPool[definitionId], view, cardPool, name);
  if (!boost) return null;
  return { instanceId, name, boost };
}

/**
 * Expected harm of playing a sequence of hazards into one company, with `boost`
 * in force.
 *
 * The boost is a parameter rather than baked into the profiles because it
 * changes twice over: the hazard events already on the board apply to every
 * attack from the start, and a support event the plan decides to play adds more.
 */
function harmOf(
  target: Target,
  cardPool: Readonly<Record<string, CardDefinition>>,
  sequence: readonly Hazard[],
  tunables: Tunables,
  boost: AttackBoost | null,
): number {
  if (sequence.length === 0) return 0;
  const result = resolveAttacks(
    target.roster, cardPool, sequence.map(h => profileOf(h, boost)), target.price,
    { maxStates: tunables.attackStateCap },
  );
  const expected = result.outcomes.reduce((sum, o) => sum + o.p * o.dtsd, 0);
  // Each hazard costs a card out of hand whatever it achieves, exactly as the
  // bundle planner charges.
  return expected - tunables.provisionalCardPrice * sequence.length;
}

/**
 * Longest sequence whose orderings are searched exhaustively.
 *
 * 4! is 24 resolutions per company, which is affordable beside the allocation
 * itself; beyond that the greedy order is kept rather than paying 120. Hazard
 * limits in practice sit at 2–4, so the cap almost never binds.
 */
const MAX_ORDERED = 4;

/** Every ordering of `items`. */
function orderings<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((item, index) => {
    for (const rest of orderings(items.filter((_, other) => other !== index))) {
      out.push([item, ...rest]);
    }
  });
  return out;
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
  const supports: Support[] = [];
  for (const card of view.self.hand) {
    const hazard = hazardOf(cardPool, card.instanceId, card.definitionId as string, killTsdOf);
    if (hazard) {
      hazards.push(hazard);
      continue;
    }
    const support = supportOf(view, cardPool, card.instanceId, card.definitionId as string);
    if (support) supports.push(support);
  }

  /**
   * What the hazard events already on the board are doing to every attack.
   *
   * A long event lasts the turn and a permanent one the game, so once one is out
   * those are simply the numbers the plan runs on — the same reading the
   * `hazards` module makes when it resolves a bundle.
   */
  const boardBoost = boostInPlay(view, cardPool);

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
        supports: [],
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
  const allocate = (targets: readonly Target[]): {
    assigned: Map<string, HazardAssignment>;
    boost: AttackBoost | null;
  } => {
    const assigned = new Map<string, HazardAssignment>();
    const unassigned = new Set(hazards.map(h => h.instanceId as string));
    const unplayed = new Set(supports.map(s => s.instanceId as string));
    /** The modifiers in force: the board's, plus every support the plan has taken. */
    let boost = boardBoost;

    /** What a company's assigned attacks are worth under `candidate`. */
    const attackHarm = (target: Target, candidate: AttackBoost | null): number =>
      harmOf(target, cardPool, target.assigned, tunables, candidate);

    /** The same, across every company — what a support's boost is measured against. */
    const attacksHarm = (candidate: AttackBoost | null): number =>
      targets.reduce((sum, t) => sum + attackHarm(t, candidate), 0);

    /**
     * A company's contribution to the plan: its attacks, less a card for each
     * support played there.
     *
     * `harmOf` charges a card per creature; a support costs one too, and charging
     * it here rather than only inside its own marginal is what keeps the credited
     * marginals summing to {@link HazardPlan.totalHarm}.
     */
    const contribution = (target: Target): number =>
      attackHarm(target, boost) - tunables.provisionalCardPrice * target.supports.length;

    /** A support changes every attack, so every company is re-priced. */
    const reprice = (): void => {
      for (const target of targets) target.harm = contribution(target);
    };

    for (;;) {
      let best:
        | { kind: 'creature'; hazard: Hazard; target: Target; marginal: number }
        | { kind: 'support'; support: Support; target: Target; marginal: number }
        | null = null;
      const attacksNow = attacksHarm(boost);
      for (const target of targets) {
        if (target.slots <= 0 || target.roster.length === 0) continue;
        for (const hazard of hazards) {
          if (!unassigned.has(hazard.instanceId as string)) continue;
          const marginal = harmOf(target, cardPool, [...target.assigned, hazard], tunables, boost)
            - attackHarm(target, boost);
          if (!best || marginal > best.marginal) best = { kind: 'creature', hazard, target, marginal };
        }
        // A support is worth what it adds to the *whole* plan, not to the company
        // whose slot it spends: Full of Froth and Rage boosts every Spider and
        // Animal attack on the board, wherever they land. It still costs a card
        // and a slot, so it only wins a round when that gain beats the creature
        // the slot would otherwise hold — and it is worth nothing at all until
        // some boostable attack has been assigned, which is why the rounds are
        // re-made rather than sorted once.
        for (const support of supports) {
          if (!unplayed.has(support.instanceId as string)) continue;
          const marginal = attacksHarm(mergeBoosts(boost, support.boost))
            - attacksNow - tunables.provisionalCardPrice;
          if (!best || marginal > best.marginal) best = { kind: 'support', support, target, marginal };
        }
      }
      if (!best || best.marginal <= 0) break;

      best.target.slots--;
      if (best.kind === 'creature') {
        best.target.assigned.push(best.hazard);
        best.target.harm += best.marginal;
        unassigned.delete(best.hazard.instanceId as string);
      } else {
        boost = mergeBoosts(boost, best.support.boost);
        best.target.supports.push(best.support);
        unplayed.delete(best.support.instanceId as string);
        reprice();
      }
    }

    /**
     * Put each company's attacks in the order they would actually be played,
     * and credit every card for what it adds *in that order*.
     *
     * The order is not the order the cards were chosen in. Greedy picks the card
     * worth most on its own and appends the next behind it, and that is not the
     * best sequence: against a two-character company, leading with the
     * high-prowess single strike and following with the many-strike attack was
     * worth 0.6 tsd more than the reverse in the position this was reported from
     * — the first attack taps a defender, and the four strikes behind it meet a
     * company one body short. The reverse can also be right: against a lone
     * already-wounded character, the near-certain kill leaves the follow-up
     * nothing to hit, so the many-strike attack leads. Both readings come out of
     * `resolveAttacks`; neither needs to be a rule.
     *
     * Only the ordering is searched, not the selection: which cards to spend is
     * left to the greedy pass above, because this service is consulted for a
     * price rather than for a move — the `hazards` module beam-searches the real
     * decision, orderings included.
     */
    const orderAndCredit = (): void => {
      for (const target of targets) {
        if (target.assigned.length > 1 && target.assigned.length <= MAX_ORDERED) {
          let bestOrder = target.assigned;
          let bestHarm = harmOf(target, cardPool, bestOrder, tunables, boost);
          for (const order of orderings(target.assigned)) {
            const harm = harmOf(target, cardPool, order, tunables, boost);
            if (harm > bestHarm) {
              bestHarm = harm;
              bestOrder = order;
            }
          }
          target.assigned.splice(0, target.assigned.length, ...bestOrder);
        }
        target.harm = contribution(target);
      }

      // Attacks are credited for what they deny with the board as it stands;
      // each support is then credited for what its boost adds on top of the
      // finished sequences. Split that way the credits sum to `totalHarm`
      // exactly, with no part of the gain paid for twice.
      for (const target of targets) {
        let running = 0;
        target.assigned.forEach((hazard, index) => {
          const upTo = harmOf(
            target, cardPool, target.assigned.slice(0, index + 1), tunables, boardBoost,
          );
          assigned.set(hazard.instanceId as string, {
            instanceId: hazard.instanceId,
            name: hazard.name,
            targetCompanyId: target.companyId,
            targetLabel: target.label,
            marginal: upTo - running,
            // Supports reach the table first, so the attacks start behind them.
            order: target.supports.length + index + 1,
            support: false,
          });
          running = upTo;
        });
      }

      let applied = boardBoost;
      let before = targets.reduce(
        (sum, t) => sum + harmOf(t, cardPool, t.assigned, tunables, applied), 0,
      );
      for (const target of targets) {
        target.supports.forEach((support, index) => {
          applied = mergeBoosts(applied, support.boost);
          const after = targets.reduce(
            (sum, t) => sum + harmOf(t, cardPool, t.assigned, tunables, applied), 0,
          );
          assigned.set(support.instanceId as string, {
            instanceId: support.instanceId,
            name: support.name,
            targetCompanyId: target.companyId,
            targetLabel: target.label,
            marginal: after - before - tunables.provisionalCardPrice,
            // First, always: a modifier reaches the table before the attacks it
            // improves, or it improves nothing.
            order: index + 1,
            support: true,
          });
          before = after;
        });
      }
    };

    orderAndCredit();
    return { assigned, boost };
  };

  const targets = makeTargets(base => base);
  const { assigned: assignments, boost: plannedBoost } = allocate(targets);

  // Everything the plan could not use. Worth nothing to keep *as an attack* —
  // which is a real statement about the hand, not a failure to price it.
  const unused = [
    ...hazards.map(h => ({ instanceId: h.instanceId, name: h.name, support: false })),
    ...supports.map(s => ({ instanceId: s.instanceId, name: s.name, support: true })),
  ];
  for (const card of unused) {
    if (assignments.has(card.instanceId as string)) continue;
    assignments.set(card.instanceId as string, {
      instanceId: card.instanceId,
      name: card.name,
      targetCompanyId: null,
      targetLabel: targets.length === 0
        ? 'no company to aim it at'
        : 'nothing left it improves',
      marginal: 0,
      order: 0,
      support: card.support,
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
      // The halved run re-derives its own boost from the board, so the totals
      // stay comparable with the full-limit plan above.

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
        const marginal = harmOf(
          target, cardPool, [...target.assigned, candidate], tunables, plannedBoost,
        ) - target.harm;
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
