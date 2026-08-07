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

import type { GameAction, CreatureCard, CardDefinition } from '@meccg/shared';
import type { ActionEvaluator } from './types.js';
import type { AiContext } from '../strategy.js';
import {
  lookupDef,
  isCreature,
  isCorruption,
  isHazardEvent,
  freeDi,
  boostsCreatureAttack,
  enablesHandCardBonus,
  discardBenefitsSelf,
} from './common.js';

/** Estimate how dangerous a creature is against a target company. */
function creatureThreat(def: CreatureCard, defenderProwess: number): number {
  const baseThreat = def.prowess * def.strikes;
  // Subtract roughly half of company prowess so big companies absorb small creatures.
  return Math.max(1, baseThreat - Math.floor(defenderProwess / 2));
}

/**
 * Highest threat score among creature cards still in hand that a hazard
 * event's board-wide stat boost would strengthen — 0 if none match.
 *
 * A boost like Full of Froth and Rage only helps attacks that happen while
 * it's in play, so it must be sequenced *before* the creature it targets.
 * Scoring it above that creature's own threat (rather than the flat event
 * baseline) makes the AI prefer playing the boost first.
 */
function boostedCreatureThreatInHand(
  eventDef: CardDefinition,
  view: AiContext['view'],
  pool: Readonly<Record<string, CardDefinition>>,
): number {
  let best = 0;
  for (const card of view.self.hand) {
    const def = lookupDef(pool, card.definitionId);
    if (!isCreature(def)) continue;
    if (!boostsCreatureAttack(eventDef, def)) continue;
    best = Math.max(best, creatureThreat(def, 0));
  }
  return best;
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
          // A creature keyed by more than one region-type/site-type reason
          // (e.g. Orc-warband keyed by both "wilderness" and "ruins-and-lairs")
          // appears as one legal action per keying justification, all playing
          // the identical card. Left unsplit, each variant scores at full
          // creature-threat weight, so the combined probability of "play this
          // creature" roughly multiplies by the number of valid keyings —
          // drowning out a board-wide boost in hand that should reliably be
          // sequenced first (see boostedCreatureThreatInHand below). Split the
          // weight across the keying variants so they total one decision's
          // worth, mirroring the place-on-guard fix.
          const keyingVariants = context.legalActions.filter(
            a => a.type === 'play-hazard' && a.cardInstanceId === action.cardInstanceId,
          ).length;
          return Math.max(1, creatureThreat(def, defenderProwess) / Math.max(1, keyingVariants));
        }
        if (isCorruption(def)) {
          // Foolish Words: target the character with the most free DI so the
          // threat of losing them to corruption is greatest.
          if (def.id === 'td-25' && action.targetCharacterId) {
            const target = view.opponent.characters[action.targetCharacterId];
            if (target) return 8 + freeDi(view, pool, target);
          }
          return 8;
        }
        if (isHazardEvent(def)) {
          // A board-wide boost (e.g. Full of Froth and Rage) is worthless
          // once played after the creature attack it targets has already
          // resolved — outscore that creature so the boost is sequenced first.
          const boosted = boostedCreatureThreatInHand(def, view, pool);
          if (boosted > 0) return boosted + 1;
          // An enabler like Doors of Night unlocks a bonus on another hazard
          // event still in hand (e.g. An Unexpected Outpost's double fetch).
          // Outscore the plain event baseline so the enabler plays first.
          if (enablesHandCardBonus(def, view, pool)) return 6;
          return 5;
        }
        return 3;
      }

      case 'play-short-event': {
        // A short event that forces the discard of an in-play hazard-event
        // (e.g. Marvels Told) offers one legal action per eligible target.
        // Left unscored, both a self-hurting target (discard my own hazard,
        // helping the opponent) and a self-helping target (discard the
        // opponent's hazard, helping me) get the same default weight — a
        // coin flip that regularly had the AI un-hindering its own hazard
        // placement on the opponent's character (bug report: Marvels Told
        // removing Foolish Words from Faramir, an opponent character).
        if (action.discardTargetInstanceId) {
          return discardBenefitsSelf(view, action.discardTargetInstanceId) ? 20 : 0;
        }
        return null;
      }

      case 'place-on-guard': {
        // Any hand card is eligible for placement (bluffing allowed), so one
        // action exists per hand card, but they're all the same underlying
        // decision — guard or not. Split a fixed total weight across them so
        // a bigger hand doesn't multiply the odds of guarding; otherwise a
        // 10-card hand would outweigh "pass" ~10x more strongly than a
        // 1-card hand for the exact same strategic situation.
        const guardOptions = context.legalActions.filter(a => a.type === 'place-on-guard').length;
        return 4 / Math.max(1, guardOptions);
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
