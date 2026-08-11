/**
 * @module ai/h2/services/portfolio
 *
 * What the agent is actually committed to, per
 * `specs/2026-08-11-h2-plan-layer.md` §3.
 *
 * Every module may *propose* plans. Only one set is *committed*, and that set
 * is the future every module then prices against. The split matters: `travel`
 * already argues that two models of the same choice will eventually disagree
 * and nothing in the output will say which was wrong, and N modules each
 * carrying a private future is that failure at strategic scale. Proposal is
 * per-module; the future is shared.
 *
 * Two jobs, and the second is the one that will break if it is skipped.
 *
 * **Compatibility.** A company cannot stand in two places, a character cannot
 * tap twice, a card cannot be played twice. The portfolio refuses the
 * impossible; it does not arbitrate the unwise, which belongs in the proposing
 * module.
 *
 * **Hysteresis.** Plain `h2` was measured spending an entire 25,000-decision
 * budget on `split-company` → `plan-movement` → `merge-companies`, two shapes
 * both scoring positive and alternating forever. Plan A and plan B alternating
 * every turn is that same bug one level up, and it is worse, because nothing
 * ever completes and the symptom is a slow loss rather than a hang. So a
 * committed plan is not dropped for being marginally out-ranked: a challenger
 * has to beat everything it displaces by `planSwitchMarginTsd`, and a plan
 * otherwise leaves the portfolio only on an explicit trigger — its deadline
 * passed, its proposer withdrew it, or `P(complete)` fell through
 * `planAbandonProbability`.
 *
 * Commitment happens **once per turn**. Re-selecting per decision would let
 * the portfolio churn inside a single organization phase, which is the same
 * thrash on a shorter clock, and it would cost a proposal pass on every one of
 * the ~170 decisions a second the agent already struggles to afford.
 */

import type { Rationale } from '../core/types.js';
import type { Plan, PlanId } from '../core/plan.js';
import type { Tunables } from '../core/tunables.js';
import { conflicts, completionProbability, expectedValueTsd, planRationale } from '../core/plan.js';
import { leaf, node } from '../core/rationale.js';

/** Why a plan that was committed is no longer. */
export type DropReason = 'deadline-passed' | 'withdrawn' | 'abandoned' | 'displaced';

/** One plan that left the portfolio this turn, and why. */
export interface DroppedPlan {
  readonly plan: Plan;
  readonly reason: DropReason;
}

/** The outcome of one turn's commitment. */
export interface Commitment {
  /** Turn the commitment was made for. */
  readonly turn: number;
  /** The committed plans, most valuable first. */
  readonly plans: readonly Plan[];
  /** Plans that left the portfolio this turn. */
  readonly dropped: readonly DroppedPlan[];
}

/** Per-game commitment state. One per agent, reset at the start of each game. */
export interface PlanPortfolio {
  /** Forget everything. A commitment must never cross games. */
  reset(): void;
  /**
   * The committed set for this turn.
   *
   * Recomputed when the turn advances and returned unchanged otherwise, so
   * calling it on every decision is cheap and stable.
   */
  commit(turn: number, proposals: readonly Plan[], tunables: Tunables): Commitment;
  /** The current commitment without proposing anything. */
  current(): Commitment;
}

/** An empty commitment, for a game that has not started planning. */
function empty(turn: number): Commitment {
  return { turn, plans: [], dropped: [] };
}

/** Build a portfolio. */
export function createPlanPortfolio(): PlanPortfolio {
  let commitment: Commitment = empty(0);

  return {
    reset(): void {
      commitment = empty(0);
    },

    current(): Commitment {
      return commitment;
    },

    commit(turn: number, proposals: readonly Plan[], tunables: Tunables): Commitment {
      if (turn === commitment.turn && commitment.plans.length + commitment.dropped.length > 0) {
        return commitment;
      }
      commitment = select(turn, commitment.plans, proposals, tunables);
      return commitment;
    },
  };
}

/**
 * One turn's selection: retain what survives, then admit challengers.
 *
 * Exported for the tests, which is the only way to check hysteresis without
 * driving a whole game — the behaviour that matters is what happens on the
 * *second* turn, and a pure function of (incumbents, proposals) is where that
 * lives.
 */
export function select(
  turn: number,
  incumbents: readonly Plan[],
  proposals: readonly Plan[],
  tunables: Tunables,
): Commitment {
  const proposed = new Map<PlanId, Plan>(proposals.map(p => [p.id, p]));
  const dropped: DroppedPlan[] = [];

  // Incumbents are re-read from this turn's proposal, because the numbers move
  // as the game does: the same commitment is a different bet once the company
  // is two regions closer or the carrier has been wounded.
  const retained: Plan[] = [];
  for (const previous of incumbents) {
    const fresh = proposed.get(previous.id);
    if (fresh === undefined) {
      dropped.push({ plan: previous, reason: 'withdrawn' });
    } else if (fresh.deadline < turn) {
      dropped.push({ plan: fresh, reason: 'deadline-passed' });
    } else if (completionProbability(fresh) < tunables.planAbandonProbability) {
      dropped.push({ plan: fresh, reason: 'abandoned' });
    } else {
      retained.push(fresh);
    }
  }

  const byValue = (a: Plan, b: Plan): number => expectedValueTsd(b) - expectedValueTsd(a);
  const selected: Plan[] = [];
  // Retained plans seat first and in value order. An incumbent that conflicts
  // with a *better* incumbent has to go: the conflict is physical, and the
  // portfolio cannot hold both however long they have both been committed.
  for (const plan of [...retained].sort(byValue)) {
    if (selected.some(other => conflicts(other, plan))) {
      dropped.push({ plan, reason: 'displaced' });
    } else {
      selected.push(plan);
    }
  }

  const incumbentIds = new Set(retained.map(p => p.id));
  for (const challenger of proposals.filter(p => !incumbentIds.has(p.id)).sort(byValue)) {
    if (challenger.deadline < turn) continue;
    if (completionProbability(challenger) < tunables.planAbandonProbability) continue;

    const blocking = selected.filter(other => conflicts(other, challenger));
    if (blocking.length === 0) {
      selected.push(challenger);
      continue;
    }
    // Displacing costs the switch margin, and against the *sum* of what it
    // displaces — otherwise one plan worth slightly more than the best of
    // three could evict all three and lose value doing it.
    const incumbentValue = blocking.reduce((sum, p) => sum + expectedValueTsd(p), 0);
    if (expectedValueTsd(challenger) > incumbentValue + tunables.planSwitchMarginTsd) {
      for (const evicted of blocking) {
        selected.splice(selected.indexOf(evicted), 1);
        dropped.push({ plan: evicted, reason: 'displaced' });
      }
      selected.push(challenger);
    }
  }

  return { turn, plans: selected.sort(byValue), dropped };
}

/** The commitment as an explanation tree, for `explain`. */
export function commitmentRationale(commitment: Commitment): Rationale {
  const total = commitment.plans.reduce((sum, p) => sum + expectedValueTsd(p), 0);
  const children: Rationale[] = commitment.plans.map(planRationale);
  if (commitment.dropped.length > 0) {
    children.push(node('dropped this turn', commitment.dropped.length,
      commitment.dropped.map(d => leaf(d.plan.goal.label, d.reason))));
  }
  if (children.length === 0) {
    children.push(leaf('nothing proposed', 'no module offered a plan for this position'));
  }
  return node('committed plans', total, children, {
    unit: 'tsd',
    note: `turn ${commitment.turn}`,
  });
}
