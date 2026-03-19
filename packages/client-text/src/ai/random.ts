/**
 * @module ai/random
 *
 * The simplest possible AI: picks a uniformly random legal action.
 * Useful as a baseline and for smoke-testing the game loop.
 */

import type { AiStrategy, AiContext } from './strategy.js';
import type { GameAction } from '@meccg/shared';

export const randomStrategy: AiStrategy = {
  name: 'random',

  pickAction(context: AiContext): GameAction {
    const idx = Math.floor(Math.random() * context.legalActions.length);
    return context.legalActions[idx];
  },
};
