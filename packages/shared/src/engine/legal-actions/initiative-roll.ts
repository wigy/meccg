/**
 * @module legal-actions/initiative-roll
 *
 * Legal actions during the initiative roll step. Each player rolls 2d6
 * to determine who goes first. No waiting for opponent — results are
 * shown immediately. Reroll on tie.
 */

import type { GameState, PlayerId, GameAction } from '../../index.js';
import { setupStepContext } from '../../state-utils.js';
import { SetupStep } from '../../types/state-phases.js';
import { logDetail } from './log.js';

export function initiativeRollActions(state: GameState, playerId: PlayerId): GameAction[] {
  const ctx = setupStepContext(state, playerId, SetupStep.InitiativeRoll);
  if (!ctx) return [];
  const roll = ctx.step.rolls[ctx.playerIndex];

  // Already rolled — waiting for opponent or reroll
  if (roll !== null) {
    logDetail(`Player already rolled (${roll.die1}+${roll.die2}=${roll.die1 + roll.die2}), waiting for opponent`);
    return [];
  }

  logDetail(`Player must roll for initiative`);
  return [{ type: 'roll-initiative', player: playerId }];
}
