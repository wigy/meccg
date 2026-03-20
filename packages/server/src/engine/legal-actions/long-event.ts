/**
 * @module legal-actions/long-event
 *
 * Legal actions during the long-event phase. The engine handles long
 * event resolution automatically; the player confirms with pass.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { logDetail } from './log.js';

export function longEventActions(_state: GameState, playerId: PlayerId): GameAction[] {
  logDetail(`Long-event phase: only pass available (engine handles resolution automatically)`);
  return [{ type: 'pass', player: playerId }];
}
