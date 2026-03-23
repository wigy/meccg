/**
 * @module legal-actions/end-of-turn
 *
 * Legal actions during the end-of-turn phase. The active player draws
 * or discards to reach hand size and may call the Free Council to
 * trigger the endgame.
 */

import type { GameState, PlayerId, GameAction } from '../../index.js';
import { logDetail } from './log.js';

export function endOfTurnActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.activePlayer !== playerId) {
    logDetail(`Not active player, no end-of-turn actions`);
    return [];
  }

  // TODO: draw/discard to hand size, call free council
  logDetail(`End-of-turn phase: only pass available (placeholder)`);
  return [{ type: 'pass', player: playerId }];
}
