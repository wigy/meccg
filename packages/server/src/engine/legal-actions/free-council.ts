/**
 * @module legal-actions/free-council
 *
 * Legal actions during the Free Council (endgame) phase. All characters
 * must make corruption checks before final marshalling points are tallied.
 */

import type { GameState, PlayerId, GameAction, CardInstanceId } from '@meccg/shared';

export function freeCouncilActions(state: GameState, playerId: PlayerId): GameAction[] {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];

  const actions: GameAction[] = [];

  // Corruption check for each character in play
  for (const charId of Object.keys(player.characters)) {
    actions.push({
      type: 'corruption-check',
      player: playerId,
      characterId: charId as CardInstanceId,
    });
  }

  actions.push({ type: 'pass', player: playerId });
  return actions;
}
