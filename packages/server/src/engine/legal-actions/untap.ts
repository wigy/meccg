/**
 * @module legal-actions/untap
 *
 * Legal actions during the untap phase. The engine handles untapping
 * automatically; the player just confirms advancement with pass.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { Phase } from '@meccg/shared';
import { logDetail } from './log.js';

export function untapActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== Phase.Untap) return [];

  if (state.phaseState.passed.includes(playerId)) {
    logDetail(`Untap phase: player ${playerId as string} already passed, waiting for opponent`);
    return [];
  }

  logDetail(`Untap phase: pass available for player ${playerId as string}`);
  return [{ type: 'pass', player: playerId }];
}
