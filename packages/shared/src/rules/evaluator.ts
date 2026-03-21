/**
 * @module rules/evaluator
 *
 * Evaluates a {@link RuleSet} against a context object to determine whether
 * a candidate action is viable. Produces an {@link EvaluatedAction} with a
 * human-readable reason when the action is not viable.
 *
 * The evaluator checks rules in order and stops at the first failure,
 * using its rendered `failMessage` as the reason. This gives players the
 * most relevant explanation for why something is unavailable.
 */

import { matchesCondition } from '../effects/condition-matcher.js';
import type { GameAction } from '../types/actions.js';
import type { RuleSet, EvaluatedAction } from './types.js';
import { renderTemplate } from './template.js';

/**
 * Evaluates all rules in a {@link RuleSet} against the given context.
 * Returns the reason string from the first failing rule, or `undefined`
 * if all rules pass.
 */
export function evaluateRules(
  ruleSet: RuleSet,
  context: Record<string, unknown>,
): string | undefined {
  for (const rule of ruleSet.rules) {
    if (!matchesCondition(rule.condition, context)) {
      return renderTemplate(rule.failMessage, context);
    }
  }
  return undefined;
}

/**
 * Evaluates a {@link RuleSet} for a candidate action and returns an
 * {@link EvaluatedAction} annotated with viability and reason.
 */
export function evaluateAction(
  action: GameAction,
  ruleSet: RuleSet,
  context: Record<string, unknown>,
): EvaluatedAction {
  const reason = evaluateRules(ruleSet, context);
  if (reason === undefined) {
    return { action, viable: true };
  }
  return { action, viable: false, reason };
}

/** Extracts only the viable actions from a list of evaluated actions. */
export function viableActions(evaluated: readonly EvaluatedAction[]): GameAction[] {
  return evaluated.filter(e => e.viable).map(e => e.action);
}
