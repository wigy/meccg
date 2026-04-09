/**
 * @module ai/heuristic
 *
 * Heuristic AI strategy — the "Smart-AI". Dispatches each legal action to
 * a phase-specific evaluator that returns a numeric weight. Combat actions
 * are routed through the combat evaluator regardless of which surrounding
 * phase they appear in (combat is a phase-independent sub-state).
 *
 * Evaluators may return `null` to defer to a default scoring pass that
 * mirrors the random strategy's pass-suppression rules. The dispatcher
 * normalizes weights and surfaces the result via the standard
 * {@link AiStrategy.weighActions} contract; sampling is performed by the
 * AI runner just like for the random strategy.
 */

import type { GameAction } from '../types/actions.js';
import type { AiStrategy, AiContext, WeightedAction } from './strategy.js';
import type { ActionEvaluator } from './evaluators/types.js';
import { setupEvaluator } from './evaluators/setup.js';
import { organizationEvaluator } from './evaluators/organization.js';
import { movementHazardEvaluator } from './evaluators/movement-hazard.js';
import { combatEvaluator } from './evaluators/combat.js';
import { sitePhaseEvaluator } from './evaluators/site-phase.js';
import { endOfTurnEvaluator } from './evaluators/end-of-turn.js';

/** Action types treated as "doing nothing" — suppressed when alternatives exist. */
const PASS_ACTIONS = new Set(['pass', 'draft-stop']);

/** Optional actions that can be passed without penalty during setup. */
const OPTIONAL_ACTIONS = new Set(['place-character', 'add-character-to-deck', 'select-starting-site']);

/** Phases where pass is freely chosen alongside substantive actions. */
const PASS_OK_PHASES = new Set(['organization']);

/** Combat-related action types that should always be routed through the combat evaluator. */
const COMBAT_ACTION_TYPES = new Set([
  'assign-strike',
  'choose-strike-order',
  'resolve-strike',
  'support-strike',
  'cancel-attack',
  'cancel-by-tap',
  'body-check-roll',
]);

/** Build the phase → evaluator routing table. */
function buildPhaseTable(): Record<string, ActionEvaluator> {
  const table: Record<string, ActionEvaluator> = {};
  const evaluators: ActionEvaluator[] = [
    setupEvaluator,
    organizationEvaluator,
    movementHazardEvaluator,
    sitePhaseEvaluator,
    endOfTurnEvaluator,
  ];
  for (const ev of evaluators) {
    for (const phase of ev.phases) table[phase] = ev;
  }
  return table;
}

const PHASE_TABLE = buildPhaseTable();

/** Look up the right evaluator for an action. */
function evaluatorFor(action: GameAction, phase: string): ActionEvaluator {
  if (COMBAT_ACTION_TYPES.has(action.type)) return combatEvaluator;
  return PHASE_TABLE[phase] ?? organizationEvaluator;
}

/** Default fallback weight when an evaluator declines to score an action. */
function defaultWeight(action: GameAction, phase: string, hasSubstantive: boolean, allOptional: boolean): number {
  const isPass = PASS_ACTIONS.has(action.type);
  const passOk = PASS_OK_PHASES.has(phase);
  if (isPass && hasSubstantive && !allOptional && !passOk) return 0;
  return 1;
}

export const heuristicStrategy: AiStrategy = {
  name: 'heuristic',

  weighActions(context: AiContext): WeightedAction[] {
    const phase = context.view.phaseState.phase;
    const actions = context.legalActions.filter(a => !('regress' in a && a.regress));

    const allOptional = actions.every(a => PASS_ACTIONS.has(a.type) || OPTIONAL_ACTIONS.has(a.type));
    const hasSubstantive = actions.some(a => !PASS_ACTIONS.has(a.type));

    return actions.map(action => {
      const evaluator = evaluatorFor(action, phase);
      const score = evaluator.score(action, context);
      const weight = score === null
        ? defaultWeight(action, phase, hasSubstantive, allOptional)
        : Math.max(0, score);
      return { action, weight };
    });
  },
};
