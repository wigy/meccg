/**
 * @module ai/evaluators/combat
 *
 * Heuristic scoring for combat sub-state actions: strike assignment,
 * strike order selection, strike resolution (with tap-to-fight choice),
 * support, and body-check rolls.
 *
 * Strategy:
 * - Assign strikes to high-prowess characters first.
 * - Tap to fight when the unmodified need is hard (>= 8) and the character
 *   is still untapped.
 * - Support a struggling defender if there is an untapped supporter and the
 *   target's roll need is hard.
 * - Body-check rolls always proceed.
 */

import type { GameAction } from '../../types/actions.js';
import type { ActionEvaluator } from './types.js';
import type { AiContext } from '../strategy.js';
import { findCharacterInPlay } from './common.js';

export const combatEvaluator: ActionEvaluator = {
  // Combat is phase-independent — these phases are where it most often
  // fires, so we let the dispatcher route the action through us whenever
  // a combat sub-state is active.
  phases: ['movement-hazard', 'site', 'organization'],

  score(action: GameAction, context: AiContext): number | null {
    const view = context.view;

    switch (action.type) {
      case 'assign-strike': {
        const found = findCharacterInPlay(view, action.characterId);
        if (!found) return 1;
        // Higher prowess characters absorb strikes better.
        const prowess = found.character.effectiveStats.prowess;
        return Math.max(1, prowess + 5);
      }

      case 'choose-strike-order': {
        // Resolve high-prowess strikes first to clear creatures faster.
        if (action.characterId) {
          const found = findCharacterInPlay(view, action.characterId);
          if (found) return Math.max(1, found.character.effectiveStats.prowess + 3);
        }
        return 5;
      }

      case 'resolve-strike': {
        // Tap to fight when the roll need is hard and the alternative not.
        if (action.tapToFight && action.need >= 8) return 20;
        if (!action.tapToFight && action.need <= 7) return 20;
        if (action.tapToFight) return 5;
        return 8;
      }

      case 'support-strike': {
        // Support is good when both characters exist and supporter is untapped.
        const supporter = findCharacterInPlay(view, action.supportingCharacterId);
        if (!supporter || !supporter.isSelf) return 1;
        return 6;
      }

      case 'cancel-attack':
        return 12;

      case 'halve-strikes':
        return 8;

      case 'cancel-by-tap':
        return 6;

      case 'body-check-roll':
        return 100;

      default:
        return null;
    }
  },
};
