/**
 * @module ai/h2/core/plan
 *
 * The vocabulary of a long-term commitment, per
 * `specs/2026-08-11-h2-plan-layer.md` §2.
 *
 * Every H2 utility is a one-step change in win probability relative to doing
 * nothing, and that is exactly what the agent cannot score with. The 107
 * recorded human-versus-AI games are 107–0, and the AI's points are
 * concentrated in `kill` — the one marshalling-point category that requires no
 * plan, because it happens to you when a hazard connects. Item, faction and
 * ally each need a multi-turn commitment, and the AI scores near-zero in all
 * three.
 *
 * A plan is what a one-step utility cannot express. Not a sequence of intended
 * actions — a **commitment carrying a payoff and a completion probability**:
 *
 * - the **goal**, an MP-bearing event that has not happened yet;
 * - its **payoff**, the *marginal* TSD of that event through `standing` and
 *   never its nominal MP, because CoE 10.3 step 4 caps a source at half the
 *   total and a third faction can be worth exactly zero;
 * - a **deadline**, the turn by which it must land;
 * - **requirements** naming what other modules have to deliver, which is how
 *   cross-module planning happens without any module modelling the whole game;
 * - **steps**, whose probabilities multiply into `P(complete)`.
 *
 * The steps are the reason this layer fits: reaching the site is `exposure`
 * and `beliefs`, surviving the automatic attack is `defence`, having a tap is
 * `budget`, making the roll is `dice`. `P(complete)` is mostly *composition of
 * services that already exist*, not new modelling.
 *
 * Nothing here scores an action. This module is the vocabulary and the
 * arithmetic; `services/portfolio` decides what is committed, and the modules
 * decide what a candidate does to it.
 */

import type { CardInstanceId, CompanyId } from '@meccg/shared';
import type { Rationale } from './types.js';
import type { MpSource } from './tsd.js';
import { leaf, node } from './rationale.js';

/**
 * Stable identity for a plan across turns.
 *
 * Stability is the whole point: the portfolio recognises a re-proposed plan as
 * *the same commitment* by this string, and hysteresis is meaningless without
 * that. Proposers must therefore derive it from what the plan is about — the
 * card, the site, the company — and never from a counter or the turn number.
 */
export type PlanId = string;

/** The MP-bearing event a plan exists to bring about. */
export interface PlanGoal {
  /** Stable, human-readable description, e.g. `"play Hauberk at Isengard"`. */
  readonly label: string;
  /** Which marshalling-point source the payoff lands in. */
  readonly source: MpSource;
  /** Raw marshalling points the event awards, before tournament adjustment. */
  readonly mp: number;
  /** The card whose play *is* the goal, when there is one. */
  readonly cardInstanceId?: CardInstanceId;
  /** Where the goal has to happen, as a site definition ID. */
  readonly siteDefinitionId?: string;
}

/**
 * Something another module has to deliver before the goal can happen.
 *
 * Requirements are named rather than assumed because that is the entire
 * coupling mechanism: `resources` proposes *play this item at that site* and
 * names the `company-at-site` it needs, `travel` sees an unmet requirement and
 * proposes the routing that satisfies it. Neither module has to know what the
 * other is for.
 */
export type Requirement =
  | {
    /** A company must be standing at a site by a given turn. */
    readonly kind: 'company-at-site';
    readonly companyId: CompanyId;
    readonly siteDefinitionId: string;
    readonly byTurn: number;
  }
  | {
    /** A character must be untapped when the goal fires. */
    readonly kind: 'untapped-character';
    readonly characterInstanceId: CardInstanceId;
  }
  | {
    /** A card must still be in hand when the goal fires. */
    readonly kind: 'card-in-hand';
    readonly cardInstanceId: CardInstanceId;
  };

/**
 * One thing that has to go right, with the probability that it does.
 *
 * Split out rather than folded into a single number so `explain` can print
 * *which* step is killing a plan. A plan at `P(complete) = 0.2` because the
 * roll is hard is a different problem from one at 0.2 because the company will
 * not survive the journey, and the portfolio's abandon rule cannot tell them
 * apart on its own.
 */
export interface PlanStep {
  /** What has to go right, e.g. `"reach Isengard"`. */
  readonly label: string;
  /** Probability it does, in [0, 1]. */
  readonly p: number;
  /**
   * The one module allowed to move this probability.
   *
   * Ownership is per *step*, and it is what makes contributions addable. §4 of
   * the spec forbids two modules booking the same payoff, and the plan owning
   * the payoff settles that — but it says nothing about two modules each
   * claiming they raised `P(complete)` by 0.3, which is the same double-count
   * one level down and just as wrong. One owner per step makes it structurally
   * impossible rather than merely forbidden, in the same way the single-owner
   * action registry does for evaluations.
   *
   * The owner is normally not the proposer: `resources` proposes *play this
   * item at that site* and owns the roll, while the probability of ever
   * reaching the site belongs to `travel`, which is the only module that knows
   * what movement costs.
   */
  readonly owner: string;
  /**
   * Machine-readable kind, for the owner to recognise its own step by.
   *
   * Labels carry the site name and read differently per plan, so matching on
   * them would couple an owner to a proposer's phrasing. The tag is the
   * contract between them: `travel` moves the step tagged `route`, whoever
   * proposed the plan and whatever they called it.
   */
  readonly tag?: string;
  /** Which service produced `p`, for the rationale tree. */
  readonly source?: string;
}

/** A commitment: a payoff, a deadline, and the probability of getting there. */
export interface Plan {
  /** Stable identity — see {@link PlanId}. */
  readonly id: PlanId;
  /** Module that proposed it. */
  readonly module: string;
  /** The MP-bearing event. */
  readonly goal: PlanGoal;
  /**
   * Marginal TSD of the goal, through `standing`.
   *
   * Never nominal MP. A planner that chases nominal points chases points it
   * cannot score, which is §2.1 of the H2 spec applied one level up.
   */
  readonly payoffTsd: number;
  /** Turn by which the goal must land, after which the plan is dead. */
  readonly deadline: number;
  /** What other modules must deliver. */
  readonly requirements: readonly Requirement[];
  /** The steps whose probabilities multiply into `P(complete)`. */
  readonly steps: readonly PlanStep[];
}

/**
 * Probability every remaining step goes right.
 *
 * A product, which assumes the steps are independent. They are not exactly —
 * a company mauled on the way to the site is likelier to fail the roll when it
 * arrives — and the assumption is recorded rather than hidden, because it
 * biases `P(complete)` *upward* and the abandon rule reads that number. A plan
 * with no steps is certain by construction: there is nothing left to go wrong.
 */
export function completionProbability(plan: Plan): number {
  return plan.steps.reduce((p, step) => p * step.p, 1);
}

/**
 * `P(complete)` with some steps' probabilities replaced, keyed by step index.
 *
 * The counterfactual behind every plan contribution: what the commitment would
 * be worth if this candidate action were taken. Indexed rather than matched by
 * label because two steps of one plan may legitimately read the same — two
 * regions to cross, both risky — and a label collision would silently move the
 * wrong one.
 */
export function completionProbabilityWith(
  plan: Plan,
  revised: ReadonlyMap<number, number>,
): number {
  return plan.steps.reduce((p, step, index) => p * (revised.get(index) ?? step.p), 1);
}

/** What the commitment is worth right now: payoff discounted by getting there. */
export function expectedValueTsd(plan: Plan): number {
  return plan.payoffTsd * completionProbability(plan);
}

/**
 * Whether two plans can be committed at the same time.
 *
 * Three ways they cannot, all of them physical rather than strategic: a
 * company cannot stand in two places, a character cannot tap twice for two
 * different goals, and a card cannot be played twice. Anything subtler than
 * this belongs in the proposing module, not here — the portfolio's job is to
 * refuse the impossible, not to arbitrate the unwise.
 */
export function conflicts(a: Plan, b: Plan): boolean {
  if (a.goal.cardInstanceId !== undefined && a.goal.cardInstanceId === b.goal.cardInstanceId) {
    return true;
  }
  for (const first of a.requirements) {
    for (const second of b.requirements) {
      if (first.kind === 'company-at-site' && second.kind === 'company-at-site'
        && first.companyId === second.companyId
        && first.siteDefinitionId !== second.siteDefinitionId) {
        return true;
      }
      if (first.kind === 'untapped-character' && second.kind === 'untapped-character'
        && first.characterInstanceId === second.characterInstanceId) {
        return true;
      }
      if (first.kind === 'card-in-hand' && second.kind === 'card-in-hand'
        && first.cardInstanceId === second.cardInstanceId) {
        return true;
      }
    }
  }
  return false;
}

/** The plan as an explanation tree, for `explain` and module rationales. */
export function planRationale(plan: Plan): Rationale {
  const steps = plan.steps.map(step => leaf(step.label, step.p, {
    unit: 'p',
    note: step.source,
  }));
  return node(plan.goal.label, expectedValueTsd(plan), [
    leaf('payoff', plan.payoffTsd, {
      unit: 'tsd',
      note: `${plan.goal.mp} ${plan.goal.source} MP, marginal at this standing`,
    }),
    leaf('deadline', plan.deadline, { unit: 'turns' }),
    node('P(complete)', completionProbability(plan), steps, {
      unit: 'p',
      note: steps.length === 0 ? 'nothing left to go wrong' : 'steps assumed independent',
    }),
    ...(plan.requirements.length > 0
      ? [node('requires', plan.requirements.length,
        plan.requirements.map(r => leaf(r.kind, describeRequirement(r))))]
      : []),
  ], { unit: 'tsd', note: `proposed by ${plan.module}` });
}

/** One requirement as a short string, for the rationale tree. */
export function describeRequirement(requirement: Requirement): string {
  switch (requirement.kind) {
    case 'company-at-site':
      return `${requirement.companyId} at ${requirement.siteDefinitionId} by turn ${requirement.byTurn}`;
    case 'untapped-character':
      return `${requirement.characterInstanceId} untapped`;
    case 'card-in-hand':
      return `${requirement.cardInstanceId} still in hand`;
  }
}

/**
 * Tag of the step asking whether anything is actually going to the site.
 *
 * Named here rather than in either module because it is the contract between
 * them: a proposer marks the step, `travel` recognises it, and neither has to
 * import the other — which is the boundary `architecture.test` enforces.
 */
export const ROUTE_STEP = 'route';

/**
 * Tag of the step asking whether the card is still in hand to be played.
 *
 * Owned by `hand`, which is the only module that discards. Its whole job is
 * to be driven to zero: a plan whose card has been thrown away is not a worse
 * bet, it is not a bet at all, and expressing that as a probability keeps one
 * mechanism where a separate veto channel would be two.
 */
export const CARD_STEP = 'card-in-hand';

/**
 * Tag of the step asking whether anyone in the company can still make the play.
 *
 * Owned by `characters`, because every action that changes who stands in a
 * company is one of its — `split-company`, `move-to-company`,
 * `discard-character`. It is binary rather than graded: the rules ask for one
 * untapped character, so the company either has one or it does not, and a
 * fraction here would be a constant nobody could calibrate.
 */
export const CARRIER_STEP = 'carrier';

/**
 * Tag of the step asking whether the influence check passes.
 *
 * Owned by `factions`, and the one step in the layer that **nothing moves** —
 * deliberately, and unlike the others. A step no module can move is normally a
 * constant pretending to be a probability, which is why the first proposer
 * shipped with one step rather than four. This one is a real 2d6, and no
 * candidate action changes the die: it belongs in `P(complete)` because
 * leaving it out would overstate every faction plan, and it stays static
 * because that is the truth about it.
 */
export const CHECK_STEP = 'influence-check';

/**
 * Probability of covering a remaining region distance, from a per-region rate.
 *
 * The route step used to be binary — certain when the company was already
 * headed to the site, a flat prior otherwise — and that is what made the agent
 * stand still. MECCG movement is multi-hop and the engine only offers
 * destinations reachable this turn, so a commitment to a distant site is
 * routinely one that no candidate can serve. Every reachable move then moved
 * the step not at all, and `travel` scores a destination with nothing playable
 * on it at exactly zero, so every movement tied with `pass` and the agent went
 * nowhere: a move planned on 32% of turns against `heuristic`'s 44%, and 16.8
 * site changes a game against 29.8.
 *
 * Grading it by distance is what makes *progress* worth something. `rate` is
 * the chance of covering one more region — `planUnroutedReachProbability`,
 * read as what it was always approximating — and the distance is the engine's
 * own inclusive region distance, where 1 means "already in that region". So a
 * company four regions out prices the plan at `rate³`, and a move that brings
 * it to two regions out raises that to `rate`, which is a real number the
 * contribution can be computed from rather than a step change nothing can
 * reach.
 *
 * No new constant: one existing tunable, one number from the map, and a shape
 * that is forced rather than chosen — independent hops multiply, which is the
 * same assumption `completionProbability` already makes about steps.
 */
export function reachProbability(inclusiveRegionDistance: number, rate: number): number {
  const hops = Math.max(0, inclusiveRegionDistance - 1);
  return hops === 0 ? 1 : Math.pow(rate, hops);
}
