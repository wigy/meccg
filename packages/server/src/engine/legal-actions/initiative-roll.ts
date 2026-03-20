/**
 * @module legal-actions/initiative-roll
 *
 * Legal actions during the initiative roll step. Each player rolls 2d6
 * to determine who goes first. No waiting for opponent — results are
 * shown immediately. Reroll on tie.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';

export function initiativeRollActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'initiative-roll') return [];

  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const roll = state.phaseState.setupStep.rolls[playerIndex];

  // Already rolled — waiting for opponent or reroll
  if (roll !== null) return [];

  return [{ type: 'roll-initiative', player: playerId }];
}
