/**
 * @module rules/types
 *
 * Type definitions for the rules engine — a declarative system for evaluating
 * card eligibility constraints during setup phases and beyond.
 *
 * Instead of hardcoded if/else chains, each constraint is expressed as a
 * {@link Rule} with a condition and a human-readable failure message.
 * The evaluator checks all rules and returns an {@link EvaluatedAction} that
 * carries both the viability verdict and the explanation.
 */

import type { Condition } from '../types/effects.js';
import type { GameAction } from '../types/actions.js';

/**
 * A single constraint that must be satisfied for an action to be viable.
 *
 * Rules are evaluated against a context object built from the current game
 * state. When the condition evaluates to `false`, the rule is violated and
 * its `failMessage` template explains why.
 */
export interface Rule {
  /** Unique identifier for this rule (for logging/debugging). */
  readonly id: string;
  /**
   * The condition to evaluate against the context.
   * When this evaluates to `false`, the action is NOT viable.
   */
  readonly condition: Condition;
  /**
   * Human-readable message template shown when this rule fails.
   * Mustache-style placeholders like `{{card.name}}` are filled from the
   * evaluation context.
   *
   * @example "{{card.name}}: mind {{card.mind}} would exceed limit ({{ctx.currentMind}} + {{card.mind}} > {{ctx.mindLimit}})"
   */
  readonly failMessage: string;
}

/**
 * A named collection of rules that ALL must pass for an action to be viable.
 * The evaluator stops at the first failing rule and uses its message as the reason.
 */
export interface RuleSet {
  /** Descriptive name for this rule set (e.g. "Character Draft Eligibility"). */
  readonly name: string;
  /** All rules in this set. ALL must pass for the candidate to be viable. */
  readonly rules: readonly Rule[];
}

/**
 * A candidate action annotated with its viability assessment.
 *
 * The server computes ALL conceivable actions for the current phase, then
 * marks each as viable or not. The client receives the full list so it can
 * render non-viable cards as dimmed with a tooltip explaining the reason.
 */
export interface EvaluatedAction {
  /** The candidate game action. */
  readonly action: GameAction;
  /** Whether this action can currently be taken. */
  readonly viable: boolean;
  /** Human-readable explanation when not viable. Absent when viable. */
  readonly reason?: string;
  /**
   * Stable canonical identifier stamped at projection time. Clients echo
   * this id when submitting an action so the server can validate by
   * membership lookup instead of re-running structural checks.
   */
  readonly actionId?: string;
}
