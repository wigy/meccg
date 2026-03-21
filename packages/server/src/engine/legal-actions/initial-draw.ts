/**
 * @module legal-actions/initial-draw
 *
 * Legal actions during the initial draw step. Each player draws
 * their starting hand of cards from the shuffled play deck.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { HAND_SIZE } from '@meccg/shared';
import { logDetail } from './log.js';

export function initialDrawActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'initial-draw') return [];

  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const stepState = state.phaseState.setupStep;

  if (stepState.drawn[playerIndex]) {
    logDetail(`Player already drew initial hand`);
    return [];
  }

  logDetail(`Must draw initial hand (${HAND_SIZE} cards)`);
  return [{ type: 'draw-cards', player: playerId, count: HAND_SIZE }];
}
