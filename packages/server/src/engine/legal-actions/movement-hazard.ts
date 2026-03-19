/**
 * @module legal-actions/movement-hazard
 *
 * Legal actions during the movement/hazard phase. Companies move to
 * their destinations while the opponent plays hazard cards. Combat
 * sub-states further constrain available actions.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';

export function movementHazardActions(state: GameState, playerId: PlayerId): GameAction[] {
  // TODO: play-hazard (for non-active player), assign-strike, resolve-strike, support-strike
  const actions: GameAction[] = [];
  actions.push({ type: 'pass', player: playerId });
  return actions;
}
