/**
 * @module cli/divergence-cost
 *
 * What a divergence between two agents is *worth*, as opposed to how often it
 * happens.
 *
 * `compare` counts disagreements, and a count is the wrong ordering for "where
 * is the strength going" — an action type that comes up two hundred times and
 * costs nothing outranks one that comes up twenty times and loses the game.
 * The driver has already ranked the candidates and publishes that ranking as
 * `considered` weights, so the gap between what it scored its own pick and what
 * it scored the shadow's is a price for taking the shadow's move instead.
 *
 * Units are the driver's. For `compare`'s default driver they are meaningful:
 * `mc` reports each candidate's mean playout TSD above the worst candidate, so
 * a difference of weights is a difference of mean TSD, estimated by playing
 * both moves forward through the real reducer.
 *
 * Three things the number is not:
 *
 * - **An oracle.** It inherits whatever the driver is wrong about, which
 *   against `mc` is a handful of uniform-random playouts that §2.3 of the
 *   rollout spec says cannot execute a plan.
 * - **Unbiased.** The driver picked the argmax of its own noisy estimates, so
 *   its own pick is favoured by the selection. That bias is roughly common
 *   across action types, which is why the ordering survives it and the absolute
 *   total does not — run the driver against *itself* to measure the floor.
 * - **Defined everywhere.** A shortlisting driver may never have scored the
 *   shadow's move. Those are counted as `unranked` rather than priced at zero,
 *   because "I did not look at it" is not "it is worth nothing".
 */

import type { GameAction } from '@meccg/shared';
import type { AgentDecision, ConsideredAction } from '../types.js';

/** What one action type's divergences cost, in the driver's own units. */
export interface CostEntry {
  /** Divergences on this type, whether or not they could be priced. */
  divergences: number;
  /** Divergences the driver had ranked both moves in. */
  priced: number;
  /** Total cost over the priced ones. */
  total: number;
  /** Divergences where the driver never scored the shadow's move. */
  unranked: number;
}

/** One priced divergence, kept so the dearest few can be printed in full. */
export interface PricedDivergence {
  cost: number;
  type: string;
  driver: string;
  shadow: string;
}

/** The action an agent prefers, ignoring the harness's sampling. */
export function preferred(decision: AgentDecision): GameAction {
  const considered: readonly ConsideredAction[] | undefined = decision.considered;
  if (!considered || considered.length === 0) return decision.action;
  return considered.reduce((best, c) => (c.weight > best.weight ? c : best), considered[0]).action;
}

/**
 * Price the shadow's preference against the driver's, in the driver's units.
 *
 * Returns `null` when the driver published no ranking, or ranked only one of
 * the two moves.
 */
export function priceOf(
  decision: AgentDecision,
  driverPick: GameAction,
  shadowPick: GameAction,
): number | null {
  const considered = decision.considered;
  if (!considered || considered.length === 0) return null;
  let driverWeight: number | undefined;
  let shadowWeight: number | undefined;
  for (const candidate of considered) {
    if (candidate.action === driverPick) driverWeight = candidate.weight;
    if (candidate.action === shadowPick) shadowWeight = candidate.weight;
  }
  if (driverWeight === undefined || shadowWeight === undefined) return null;
  return driverWeight - shadowWeight;
}

/** Accumulates the cost table across a run. */
export class DivergenceCost {
  readonly byType = new Map<string, CostEntry>();
  readonly priced: PricedDivergence[] = [];

  /** Record one divergence, priced where the driver ranked both moves. */
  record(
    decision: AgentDecision,
    shadowPick: GameAction,
    describe: (action: GameAction) => string,
  ): void {
    const driverPick = preferred(decision);
    const type = driverPick.type;
    const entry = this.byType.get(type) ?? { divergences: 0, priced: 0, total: 0, unranked: 0 };
    entry.divergences++;
    const cost = priceOf(decision, driverPick, shadowPick);
    if (cost === null) {
      entry.unranked++;
    } else {
      entry.priced++;
      entry.total += cost;
      this.priced.push({ cost, type, driver: describe(driverPick), shadow: describe(shadowPick) });
    }
    this.byType.set(type, entry);
  }

  /** Action types by total cost, dearest first. */
  ranked(): [string, CostEntry][] {
    return [...this.byType.entries()].sort((a, b) => b[1].total - a[1].total);
  }

  /** Total cost over every action type. */
  total(): number {
    let sum = 0;
    for (const entry of this.byType.values()) sum += entry.total;
    return sum;
  }
}
