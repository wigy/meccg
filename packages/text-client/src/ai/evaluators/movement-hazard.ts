/**
 * @module ai/evaluators/movement-hazard
 *
 * Heuristic scoring for the Movement/Hazard phase, including hazard play
 * (creatures and events keyed against the moving company), on-guard
 * placements, and effect ordering.
 *
 * Resource-side actions (select-company, declare-path) get a flat positive
 * weight so they actually progress. Hazard-side actions are scored based on
 * the threat they pose: prowess gap vs. defenders for creatures, corruption
 * stacking for corruption hazards, and a small baseline for events.
 */

import type { GameAction, CreatureCard } from '@meccg/shared';
import type { ActionEvaluator } from './types.js';
import type { AiContext } from '../strategy.js';
import {
  lookupDef,
  isCreature,
  isCorruption,
  isHazardEvent,
} from './common.js';

/** Estimate how dangerous a creature is against a target company. */
function creatureThreat(def: CreatureCard, defenderProwess: number): number {
  const baseThreat = def.prowess * def.strikes;
  // Subtract roughly half of company prowess so big companies absorb small creatures.
  return Math.max(1, baseThreat - Math.floor(defenderProwess / 2));
}

export const movementHazardEvaluator: ActionEvaluator = {
  phases: ['movement-hazard'],

  score(action: GameAction, context: AiContext): number | null {
    const view = context.view;
    const pool = context.cardPool;

    switch (action.type) {
      case 'draw-cards':
        // Always draw the maximum number of cards — card advantage is
        // always worth taking.
        return 100;

      case 'select-company':
        return 10;

      case 'declare-path':
        // Prefer Starter movement (printed path) when available.
        return action.movementType === 'starter' ? 12 : 8;

      case 'order-effects':
        return 10;

      case 'play-hazard': {
        const card = view.self.hand.find(c => c.instanceId === action.cardInstanceId);
        if (!card) return 1;
        const def = lookupDef(pool, card.definitionId);
        if (!def) return 1;

        if (isCreature(def)) {
          // Find the targeted opponent company to estimate defender prowess.
          const targetCompany = view.opponent.companies.find(c => c.id === action.targetCompanyId);
          let defenderProwess = 0;
          if (targetCompany) {
            for (const charId of targetCompany.characters) {
              const char = view.opponent.characters[charId];
              if (char) defenderProwess += char.effectiveStats.prowess;
            }
          }
          return Math.max(1, creatureThreat(def, defenderProwess));
        }
        if (isCorruption(def)) {
          // Pile corruption on heavy carriers; bonus when characterId is given.
          return 8;
        }
        if (isHazardEvent(def)) {
          return 5;
        }
        return 3;
      }

      case 'place-on-guard': {
        // Lay something on-guard occasionally — moderate weight.
        return 4;
      }

      case 'pass':
        // Never pass while cards can still be drawn — always take the
        // maximum number of draws offered.
        if (context.legalActions.some(a => a.type === 'draw-cards')) return 0;
        return 1;

      default:
        return null;
    }
  },
};
