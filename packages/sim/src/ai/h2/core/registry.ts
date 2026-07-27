/**
 * @module ai/h2/core/registry
 *
 * Module ownership and decision dispatch.
 *
 * The registry is the single source of truth for which module owns which
 * actions, which is what keeps the module set from sprawling into hidden
 * coupling. It also implements the hybrid fallback that makes per-module
 * shipping possible: a decision no H2 module claims is handled by Heuristics 1
 * exactly as before, so each module can be enabled, gated and measured on its
 * own (`gate --challenger h2:combat --champion heuristic`).
 *
 * Dispatch is per **decision**, not per action. Scoring half the candidates in
 * win-probability deltas and the other half in H1's unitless weights would put
 * incomparable numbers in one distribution — the precise defect Heuristics 2
 * exists to remove. So a module claims a decision only if it can score every
 * action offered there, and otherwise the whole decision falls through.
 */

import type { GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext } from './types.js';
import { assertValidDistribution } from './tsd.js';
import { combatModule } from '../modules/combat/combat.js';
import { travelModule } from '../modules/travel/travel.js';

/**
 * Every module that exists, in dependency order.
 *
 * The core, the `standing` service and the tooling shipped first (P0) so that
 * the first real module arrived with an explanation renderer, a scenario
 * corpus and a calibration harness already waiting for it, rather than being
 * validated by eye.
 */
export const ALL_MODULES: readonly H2Module[] = [combatModule, travelModule];

/** Look up modules by name, throwing on an unknown one. */
export function resolveModules(spec: string | undefined, available: readonly H2Module[] = ALL_MODULES): H2Module[] {
  if (spec === undefined || spec === 'all' || spec === '') return [...available];
  const names = spec.split(',').map(s => s.trim()).filter(s => s.length > 0);
  return names.map(name => {
    const found = available.find(m => m.name === name);
    if (!found) {
      const known = available.map(m => m.name).join(', ') || '(none yet)';
      throw new Error(`Unknown H2 module "${name}" — available: ${known}`);
    }
    return found;
  });
}

/**
 * Default claim rule: the module owns the type of every action on offer.
 *
 * An empty candidate list is never claimed — "owns every action" is
 * vacuously true of nothing, and a module that claimed it would report an
 * empty ranking as though it were an opinion.
 */
function ownsEveryAction(module: H2Module, legalActions: readonly GameAction[]): boolean {
  if (legalActions.length === 0) return false;
  const owned = new Set(module.ownedActionTypes);
  return legalActions.every(a => owned.has(a.type));
}

/** The first enabled module that claims this decision, or `null` for H1. */
export function moduleForDecision(modules: readonly H2Module[], context: ModuleContext): H2Module | null {
  for (const module of modules) {
    const claims = module.claims
      ? module.claims(context)
      : ownsEveryAction(module, context.legalActions);
    if (claims) return module;
  }
  return null;
}

/** The result of asking H2 to handle one decision. */
export interface DecisionEvaluation {
  /** The module that claimed the decision, or `null` when H1 must handle it. */
  readonly module: H2Module | null;
  /** One evaluation per legal action, ranked best first. Empty when H1 owns it. */
  readonly evaluations: readonly Evaluation[];
}

/**
 * Evaluate a decision with the enabled modules.
 *
 * A module that returns `null` for any action withdraws its claim for the
 * whole decision — a partially-scored candidate list cannot be ranked
 * honestly, and falling back is always safe.
 */
export function evaluateDecision(
  modules: readonly H2Module[],
  context: ModuleContext,
): DecisionEvaluation {
  const module = moduleForDecision(modules, context);
  if (!module) return { module: null, evaluations: [] };

  const evaluations: Evaluation[] = [];
  for (const action of context.legalActions) {
    const evaluation = module.evaluate(action, context);
    if (!evaluation) return { module: null, evaluations: [] };
    assertValidDistribution(evaluation.outcomes, module.name);
    evaluations.push(evaluation);
  }
  evaluations.sort((a, b) => b.utility - a.utility);
  return { module, evaluations };
}
