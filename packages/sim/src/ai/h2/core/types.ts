/**
 * @module ai/h2/core/types
 *
 * The vocabulary every Heuristics-2 module speaks.
 *
 * Heuristics 1 scores actions with unitless per-phase weights that are only
 * comparable inside a single evaluator. H2 replaces that with one common
 * currency: a module answers a candidate action with an **outcome
 * distribution** — a small enumerated set of mutually exclusive outcomes,
 * each carrying a tournament-score differential (TSD) delta — and the
 * distribution is converted to a change in win probability by the risk
 * oracle. Because the units are shared, two modules' opinions can be ranked
 * against each other, and any single number can be traced back through its
 * {@link Rationale} to the rule or tunable that produced it.
 *
 * See `specs/2026-07-27-heuristics-2-ai.md` §2 for the design rationale.
 */

import type { CardDefinition, GameAction, MarshallingPointTotals, PlayerView } from '@meccg/shared';
import type { RiskPosture, ScoredOutcomes } from './risk.js';
import type { MpDelta, MpSource } from './tsd.js';
import type { WinProbModel } from './winprob.js';
import type { Tunables } from './tunables.js';
import type { Commitment, Plan, PlanStep } from './plan.js';

/** Unit of a {@link Rationale} value, so renderers can format it correctly. */
export type RationaleUnit =
  /** A probability in [0, 1]. */
  | 'p'
  /** A tournament-score differential, the common currency. */
  | 'tsd'
  /** Raw marshalling points, before tournament adjustments. */
  | 'mp'
  /** A number of turns. */
  | 'turns'
  /** A win probability in [0, 1]. */
  | 'winprob';

/**
 * One node of the explanation tree that accompanies every evaluation.
 *
 * This is a hard requirement of the design rather than a debug convenience:
 * the `explain` CLI, the golden tests and the tuning workflow all read it, and
 * the "no anonymous constants" invariant is enforced by checking that every
 * hand-chosen number names the {@link Tunables} field it came from.
 */
export interface Rationale {
  /** What this line reports, e.g. `"P(wound | tap to face strike)"`. */
  readonly label: string;
  /** The reported value. Strings are for categorical facts (a site name). */
  readonly value: number | string;
  /** Unit of `value`, driving how the renderer formats it. */
  readonly unit?: RationaleUnit;
  /** Free-form note, typically a rule citation such as `"CoE 3.iv.3"`. */
  readonly note?: string;
  /** Name of the {@link Tunables} field this number came from, when any. */
  readonly tunable?: string;
  /** Sub-derivations of this line. */
  readonly children?: readonly Rationale[];
}

/**
 * One reachable result of taking an action, with the probability it occurs
 * and the tournament-score differential it produces.
 *
 * `dtsd` is the *net* change per §2.3 of the plan: realized MP movement, plus
 * discounted potential, minus the tempo spent getting there. Keeping the three
 * terms folded into one number here (and split in the rationale) is what lets
 * the risk oracle integrate the win-probability curve over outcomes.
 */
export interface Outcome {
  /** Probability of this outcome, in [0, 1]. All outcomes must sum to 1. */
  readonly p: number;
  /** Short human-readable description, e.g. `"Gimli wounded"`. */
  readonly label: string;
  /** Change in tournament-score differential if this outcome happens. */
  readonly dtsd: number;
}

/** How a module turned its outcome distribution into a utility. */
export type UtilityMethod =
  /** Exact: `Σ p·W(tsd + Δ) − W(tsd)`, integrating the win-probability curve. */
  | 'integrated'
  /** Cheap fallback: `μ + λ·σ` in TSD units, then scaled to win probability. */
  | 'mean-variance';

/**
 * A module's complete opinion about one candidate action.
 *
 * Every field is reported rather than derived on demand so an evaluation can
 * be serialised to JSON, diffed by a test, and re-rendered by the CLI without
 * re-running the module.
 */
export interface Evaluation {
  /** The action this evaluation is about. */
  readonly action: GameAction;
  /** Name of the module that produced it. */
  readonly module: string;
  /** The enumerated outcome distribution; probabilities sum to 1. */
  readonly outcomes: readonly Outcome[];
  /** Mean of `dtsd` over `outcomes`. */
  readonly expectedTsd: number;
  /** Standard deviation of `dtsd` over `outcomes` — the risk of the action. */
  readonly sigmaTsd: number;
  /** Change in win probability, the ranking key. */
  readonly utility: number;
  /** How `utility` was computed from the distribution. */
  readonly method: UtilityMethod;
  /** The explanation tree. */
  readonly rationale: Rationale;
  /**
   * Simplifications the number rests on, e.g. `"opponent plays no cards into
   * this combat"`. Printed by `explain` so a confident-looking utility can
   * never hide the assumption that made it cheap to compute.
   */
  readonly assumptions: readonly string[];
}

/** Where the score stands and what a marginal point is worth. */
export interface Standing {
  /** The player's own raw MP totals. */
  readonly selfMp: MarshallingPointTotals;
  /** The opponent's raw MP totals (public information). */
  readonly opponentMp: MarshallingPointTotals;
  /** The player's tournament-adjusted per-source values. */
  readonly selfBreakdown: MarshallingPointTotals;
  /** The opponent's tournament-adjusted per-source values. */
  readonly opponentBreakdown: MarshallingPointTotals;
  /** The player's tournament score. */
  readonly selfScore: number;
  /** The opponent's tournament score. */
  readonly opponentScore: number;
  /** Tournament-score differential from the player's perspective. */
  readonly tsd: number;
  /** TSD value of +1 raw MP in each source — often 2, 1, or 0. */
  readonly marginal: Readonly<Record<MpSource, number>>;
  /** Current turn number. */
  readonly turnNumber: number;
  /** Risk posture derived from the curvature of `W` at this standing. */
  readonly risk: RiskPosture;
  /** The win-probability model in use. */
  readonly model: WinProbModel;
  /** TSD after hypothetical MP changes on either side. */
  tsdAfter(selfDelta: MpDelta, opponentDelta?: MpDelta): number;
  /** Convert an outcome distribution to a win-probability delta. */
  score(outcomes: readonly Outcome[]): ScoredOutcomes;
  /** The standing as an explanation tree, for `explain` and module rationales. */
  rationale(): Rationale;
}

/**
 * Everything a module may read while evaluating. Modules see only the
 * projected {@link PlayerView} — never `GameState` — so an H2 agent is subject
 * to exactly the same hidden-information boundary as every other agent.
 */
export interface ModuleContext {
  /** The acting player's projected view. */
  readonly view: PlayerView;
  /** Static card pool for resolving definitions. */
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  /** The viable actions at this decision point. */
  readonly legalActions: readonly GameAction[];
  /** The single typed constants object. */
  readonly tunables: Tunables;
  /** Scoring standing: TSD now, per-source marginal MP value, risk posture. */
  readonly standing: Standing;
  /**
   * Where each company has already been sent, by company id, as site
   * *definition* ids in the order chosen.
   *
   * Not in the game state, and it cannot be: nothing in the rules records a
   * company's history, and the site card returns to the site deck rather than
   * to a discard pile — a destination already worked is offered again exactly
   * like one never seen. The agent has to remember, the same way `cycle-guard`
   * remembers positions the engine cannot mark.
   *
   * Empty when the agent has not been driving, which is the honest reading in
   * corpus replay: it records the agent's *own* choices, so a route it did not
   * walk leaves no trace here.
   */
  readonly visited?: Readonly<Record<string, readonly string[]>>;
  /**
   * How many times each item, by instance id, has already been transferred
   * between characters this turn.
   *
   * Not in the game state, for the same reason `visited` is not: nothing in
   * the rules records how many hops an item has taken this turn, so a fourth
   * hop reads exactly like a first one unless the agent remembers. The health
   * module reads it to charge `repeatedTransferCost` from the second hop
   * onward, which is what stops a company-mate's item, priced at zero risk
   * because the giving-up bearer's corruption is too low to ever fail the
   * check (`checkRisk`), from touring the whole company one hop per decision.
   *
   * Empty when the agent has not been driving, the same honest-in-replay
   * reading `visited` uses.
   */
  readonly itemTransfers?: Readonly<Record<string, number>>;
  /**
   * The committed portfolio, when the agent has one.
   *
   * Absent for proposers — they run *before* commitment, and a proposer that
   * could read the commitment could propose what is already committed into a
   * feedback loop — and for tools that evaluate without a portfolio. A module
   * reading it must degrade gracefully to "no plans".
   */
  readonly commitment?: Commitment;
}

/**
 * One evaluation module: it owns a set of action types, and when it claims a
 * decision it must be able to score every action offered there.
 *
 * Claiming is per *decision*, not per action, and deliberately so: mixing an
 * H2 utility (a win-probability delta) with an H1 weight (a unitless number)
 * in one distribution would reintroduce exactly the incomparable-scales
 * problem H2 exists to remove. A decision therefore goes wholly to a module or
 * wholly to the H1 fallback.
 */
export interface H2Module {
  /** Module name, as used by the `h2:<modules>` agent spec and `--module`. */
  readonly name: string;
  /** Action types this module can score. */
  readonly ownedActionTypes: readonly string[];
  /**
   * Whether this module takes responsibility for the whole decision.
   * Defaults to "every legal action's type is owned by this module".
   */
  claims?(context: ModuleContext): boolean;
  /** Score one action. Returning `null` withdraws the module's claim. */
  evaluate(action: GameAction, context: ModuleContext): Evaluation | null;
  /**
   * Long-term commitments this module can see from here, if any.
   *
   * Optional, and most modules will never implement it: `combat` and
   * `corruption` price what is happening now, and nothing about a strike is a
   * multi-turn commitment. What a proposer offers is a *candidate* future —
   * `services/portfolio` decides which proposals are compatible and which
   * survive from last turn, because N modules each carrying a private future
   * is the disagreement `travel` already warns about, at strategic scale.
   *
   * Called once per turn rather than once per decision. A proposer may be
   * asked in any phase and must return the same commitments it would return
   * anywhere else in the turn; anything that changes within a turn is a
   * tactical judgement and belongs in {@link evaluate}.
   *
   * Re-proposing an unchanged commitment **must** reuse its {@link Plan.id} —
   * that string is how the portfolio recognises an incumbent, and hysteresis
   * is meaningless without it.
   */
  proposePlans?(context: ModuleContext): readonly Plan[];
  /**
   * What this action would do to a plan step this module owns.
   *
   * Returns the step's revised probability, or `null` to say the action leaves
   * it alone — which is the answer for almost every (action, step) pair, so
   * returning `null` cheaply matters more than the interesting case being fast.
   *
   * Only the step's {@link PlanStep.owner} is ever asked. That is the rule that
   * makes contributions addable: without it, `travel` and `resources` can each
   * report that they raised the same `P(complete)` by 0.3, and the sum is wrong
   * in exactly the way the single-owner action registry exists to prevent.
   *
   * The baseline is `pass`, so this answers "instead of doing nothing", which
   * is the same counterfactual every H2 utility is already measured against.
   * A step driven to zero *is* the veto channel: an action that discards the
   * card the plan needs makes the plan impossible rather than merely worse, and
   * expressing that as a probability keeps one mechanism instead of two.
   */
  planStepDelta?(
    action: GameAction,
    plan: Plan,
    step: PlanStep,
    stepIndex: number,
    context: ModuleContext,
  ): number | null;
}
