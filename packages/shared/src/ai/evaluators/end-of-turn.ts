/**
 * @module ai/evaluators/end-of-turn
 *
 * Heuristic scoring for the End-of-Turn phase: drawing back to hand size,
 * discarding excess cards, calling the Free Council, deck-exhaust handling,
 * and sideboard exchanges.
 *
 * Discard priority (high score = first to drop):
 *   1. Duplicate uniques (already in play)
 *   2. Hazard creatures we don't need any more
 *   3. Resource events with high mind / no payoff
 *   4. Anything else (low score)
 */

import type { GameAction } from '../../types/actions.js';
import type { ActionEvaluator } from './types.js';
import type { AiContext } from '../strategy.js';
import { lookupDef, isCharacter } from './common.js';
import { computeTournamentScore } from '../../state-utils.js';

export const endOfTurnEvaluator: ActionEvaluator = {
  phases: ['end-of-turn', 'long-event', 'free-council', 'game-over'],

  score(action: GameAction, context: AiContext): number | null {
    const view = context.view;
    const pool = context.cardPool;

    switch (action.type) {
      case 'draw-cards':
        return 100;

      case 'discard-card': {
        const card = view.self.hand.find(c => c.instanceId === action.cardInstanceId);
        if (!card) return 1;
        const def = lookupDef(pool, card.definitionId);
        if (!def) return 1;

        // Drop high-mind characters first if hand is full and we cannot afford them.
        if (isCharacter(def) && (def.mind ?? 0) >= 6) return 8;
        // Drop hazards we no longer need.
        if (def.cardType === 'hazard-creature' || def.cardType === 'hazard-event' || def.cardType === 'hazard-corruption') return 6;
        return 3;
      }

      case 'call-free-council': {
        // Probability-based gate. Both MP totals are public info, so we can
        // compute the doubling-rule tournament score straight from the view.
        // Probability curve over the lead (self − opponent):
        //   lead ≤ 0   → 0%   (never call when tied or behind)
        //   lead 1–4   → 5%   (small chance — usually too early)
        //   lead 5–19  → linear interpolation 5% → 100%
        //   lead ≥ 20  → 100% (always call: the lead is decisive)
        // We turn the probability into a hard yes/no by rolling once and
        // returning either a very large or zero weight, so the dispatcher
        // picks `pass` instead when we decide not to call.
        const selfScore = computeTournamentScore(view.self.marshallingPoints, view.opponent.marshallingPoints);
        const oppScore = computeTournamentScore(view.opponent.marshallingPoints, view.self.marshallingPoints);
        const lead = selfScore - oppScore;

        let probability: number;
        if (lead <= 0) probability = 0;
        else if (lead <= 4) probability = 0.05;
        else if (lead >= 20) probability = 1.0;
        else probability = 0.05 + (lead - 4) * (0.95 / 16);

        return Math.random() < probability ? 1_000_000 : 0;
      }

      case 'deck-exhaust':
        return 100;

      case 'finished':
        return 100;

      case 'pass':
        return 1;

      default:
        return null;
    }
  },
};
