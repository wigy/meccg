/**
 * @module rule-10.20-rule-changes-not-actions
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.20: Rule Changes Not Actions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Changing the game rules is not considered an action as it does not actively change the board state (e.g. an effect that creates a new restriction as to what can or cannot be done with specified entities; modifies how much general influence a player has; modifies the number of cards players draw when moving; contains words like "consider," "treat," "instead of," or similar words/phrases that modify the rules rather than the actual board state, etc.).
 */

import { describe, test } from 'vitest';

// Rule-changing effects (a general-influence modifier, a draw-count
// modifier, a new restriction) are all modeled as `ActiveConstraint`s and
// `stat-modifier`/`draw-modifier`/etc. DSL effects consulted by other
// systems' computations — never as a dispatched `GameAction` in their own
// right. This is already true by construction: there is no action type in
// actions.ts for "install a rule change", only ones for playing the card
// that happens to install one. The distinction is exercised implicitly by
// every card test involving such an effect; there's no separate scenario
// that isolates "this rule change was not also counted as an action".
describe('Rule 10.20 — Rule Changes Not Actions', () => {
  test.todo('Changing game rules is not considered an action (e.g. restrictions, modifications, "consider"/"treat"/"instead of")');
});
