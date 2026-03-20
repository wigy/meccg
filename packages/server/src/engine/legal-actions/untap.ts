/**
 * @module legal-actions/untap
 *
 * Legal actions during the untap phase. The engine handles untapping
 * automatically; the player just confirms advancement with pass.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { logDetail } from './log.js';

export function untapActions(_state: GameState, playerId: PlayerId): GameAction[] {
  logDetail(`Untap phase: only pass available (engine handles untapping automatically)`);
  return [{ type: 'pass', player: playerId }];
}
