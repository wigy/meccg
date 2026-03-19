/**
 * @module ai/random
 *
 * The simplest AI: uniform random over all legal actions,
 * except pass gets zero weight when other actions are available
 * during the draft phase.
 */

import type { AiStrategy, AiContext, WeightedAction } from './strategy.js';

export const randomStrategy: AiStrategy = {
  name: 'random',

  weighActions(context: AiContext): WeightedAction[] {
    const { legalActions, view } = context;
    const isDraft = view.phaseState.phase === 'character-draft';
    const hasNonPass = legalActions.some(a => a.type !== 'draft-stop' && a.type !== 'pass');

    return legalActions.map(action => {
      // During draft, don't stop if there are characters to pick
      if (isDraft && action.type === 'draft-stop' && hasNonPass) {
        return { action, weight: 0 };
      }
      return { action, weight: 1 };
    });
  },
};
