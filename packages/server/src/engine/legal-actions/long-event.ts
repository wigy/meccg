/**
 * @module legal-actions/long-event
 *
 * Legal actions during the long-event phase. The engine handles long
 * event resolution automatically; the player confirms with pass.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';

export function longEventActions(_state: GameState, playerId: PlayerId): GameAction[] {
  return [{ type: 'pass', player: playerId }];
}
