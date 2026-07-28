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
 * Coverage is **collective**. Every module is always in use, so the question is
 * not whether one module owns a whole decision but whether the module set
 * between them owns every candidate on it. Each action is routed to its owner
 * and the resulting utilities are ranked together; they are comparable because
 * they are all win-probability deltas.
 *
 * The one thing that must never happen is a ranking mixing an H2 utility with
 * an H1 weight, which is unitless and comparable only inside one evaluator —
 * the precise defect Heuristics 2 exists to remove. So coverage is all or
 * nothing: if a single candidate has no owner, the whole decision falls
 * through to Heuristics 1.
 *
 * An earlier version required *one* module to own the whole decision. That is
 * satisfiable in combat, which is a closed sub-state, and unsatisfiable in the
 * organization phase, which offers movement, transfers, influence changes and
 * sideboard actions in one candidate list — so it made the entire phase
 * unreachable no matter how many modules were built.
 */

import type { GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext } from './types.js';
import { assertValidDistribution } from './tsd.js';
import { combatModule } from '../modules/combat/combat.js';
import { corruptionModule } from '../modules/corruption/corruption.js';
import { factionsModule } from '../modules/factions/factions.js';
import { resourcesModule } from '../modules/resources/resources.js';
import { travelModule } from '../modules/travel/travel.js';

/**
 * Every module that exists, in dependency order.
 *
 * The core, the `standing` service and the tooling shipped first (P0) so that
 * the first real module arrived with an explanation renderer, a scenario
 * corpus and a calibration harness already waiting for it, rather than being
 * validated by eye.
 */
export const ALL_MODULES: readonly H2Module[] = [combatModule, corruptionModule, factionsModule, resourcesModule, travelModule];

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
 * The module that owns one action here, or null when none does.
 *
 * Ownership is the action type *and* the module's context gate: `pass` is
 * listed by more than one module because it means something different in each
 * place, and `claims()` is what tells them apart — combat's gate wants an
 * active combat it is defending, travel's wants somewhere to move.
 */
export function ownerOf(
  modules: readonly H2Module[],
  action: GameAction,
  context: ModuleContext,
): H2Module | null {
  for (const module of modules) {
    if (!module.ownedActionTypes.includes(action.type)) continue;
    if (module.claims && !module.claims(context)) continue;
    return module;
  }
  return null;
}

/**
 * Whether the module set covers every candidate on this decision.
 *
 * An empty candidate list is never covered — "owns everything" is vacuously
 * true of nothing, and reporting an empty ranking as an opinion would be
 * worse than falling through.
 */
export function coversDecision(modules: readonly H2Module[], context: ModuleContext): boolean {
  if (context.legalActions.length === 0) return false;
  return context.legalActions.every(a => ownerOf(modules, a, context) !== null);
}

/** The result of asking H2 to handle one decision. */
export interface DecisionEvaluation {
  /**
   * The modules that scored this decision, or empty when Heuristics 1 must
   * handle it. More than one is normal: a phase that offers movement and
   * transfers together is covered by `travel` and `items` between them.
   */
  readonly modules: readonly string[];
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
  if (!coversDecision(modules, context)) return { modules: [], evaluations: [] };

  const evaluations: Evaluation[] = [];
  const contributors = new Set<string>();
  for (const action of context.legalActions) {
    const owner = ownerOf(modules, action, context);
    // Covered above, but a module that declines an action it owns withdraws
    // the whole decision: a partially-scored candidate list cannot be ranked
    // honestly, and falling back is always safe.
    const evaluation = owner?.evaluate(action, context);
    if (!owner || !evaluation) return { modules: [], evaluations: [] };
    assertValidDistribution(evaluation.outcomes, owner.name);
    contributors.add(owner.name);
    evaluations.push(evaluation);
  }
  evaluations.sort((a, b) => b.utility - a.utility);
  return { modules: [...contributors].sort(), evaluations };
}
