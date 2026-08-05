/**
 * @module legal-actions/initial-draw
 *
 * Legal actions during the initial draw step. Each player draws
 * their starting hand of cards from the shuffled play deck.
 */

import type { GameState, PlayerId, GameAction } from '../../index.js';
import { HAND_SIZE } from '../../constants.js';
import { setupStepContext } from '../../state-utils.js';
import { SetupStep } from '../../types/state-phases.js';
import { logDetail } from './log.js';

export function initialDrawActions(state: GameState, playerId: PlayerId): GameAction[] {
  const ctx = setupStepContext(state, playerId, SetupStep.InitialDraw);
  if (!ctx) return [];
  const { step: stepState, playerIndex } = ctx;

  if (stepState.drawn[playerIndex]) {
    logDetail(`Player already drew initial hand`);
    return [];
  }

  // CoE 1.11: draws "up to" the base hand size — a Stage resource already in
  // hand (deferred to hand during draft finalization) counts toward it.
  const player = state.players[playerIndex];
  const count = Math.max(0, HAND_SIZE - player.hand.length);
  logDetail(`Must draw initial hand (${count} card(s) to reach ${HAND_SIZE}, ${player.hand.length} already in hand)`);
  return [{ type: 'draw-cards', player: playerId, count }];
}
