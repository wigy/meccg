/**
 * @module ai/random
 *
 * The simplest AI: uniform random over all legal actions.
 * Pass/stop actions get zero weight when substantive actions exist,
 * ensuring the AI always prefers to do something over passing.
 * When pass/stop is the only option, it gets 100%.
 */

import type { AiStrategy, AiContext, WeightedAction } from './strategy.js';

/** Action types that represent "doing nothing" — zero weight when alternatives exist. */
const PASS_ACTIONS = new Set(['pass', 'draft-stop']);

/** Action types that are optional — pass gets equal weight alongside them. */
const OPTIONAL_ACTIONS = new Set(['place-character', 'add-character-to-deck', 'select-starting-site']);

export const randomStrategy: AiStrategy = {
  name: 'random',

  weighActions(context: AiContext): WeightedAction[] {
    const { legalActions } = context;
    const allOptional = legalActions.every(a => PASS_ACTIONS.has(a.type) || OPTIONAL_ACTIONS.has(a.type));
    const hasSubstantiveAction = legalActions.some(a => !PASS_ACTIONS.has(a.type));

    return legalActions.map(action => {
      if (PASS_ACTIONS.has(action.type) && hasSubstantiveAction && !allOptional) {
        return { action, weight: 0 };
      }
      return { action, weight: 1 };
    });
  },
};
