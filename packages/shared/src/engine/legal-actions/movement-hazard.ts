/**
 * @module legal-actions/movement-hazard
 *
 * Legal actions during the movement/hazard phase. Companies move to
 * their destinations while the opponent plays hazard cards. Combat
 * sub-states further constrain available actions.
 */

import type { GameState, PlayerId, GameAction } from '../../index.js';
import { logDetail } from './log.js';

export function movementHazardActions(state: GameState, playerId: PlayerId): GameAction[] {
  // TODO: play-hazard (for non-active player), assign-strike, resolve-strike, support-strike
  const isActive = state.activePlayer === playerId;
  logDetail(`Movement/hazard phase: player is ${isActive ? 'active (mover)' : 'non-active (hazard player)'}`);

  if (!isActive) {
    logDetail(`Not active player, no movement/hazard actions`);
    return [];
  }

  return [{ type: 'pass', player: playerId }];
}
