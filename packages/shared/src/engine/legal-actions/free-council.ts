/**
 * @module legal-actions/free-council
 *
 * Legal actions during the Free Council (endgame) phase. All characters
 * must make corruption checks before final marshalling points are tallied.
 */

import type { GameState, PlayerId, GameAction, CardInstanceId } from '../../index.js';
import { logDetail } from './log.js';

export function freeCouncilActions(state: GameState, playerId: PlayerId): GameAction[] {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];

  const charCount = Object.keys(player.characters).length;
  logDetail(`Free Council: ${charCount} character(s) need corruption checks`);

  const actions: GameAction[] = [];

  // Corruption check for each character in play
  for (const charId of Object.keys(player.characters)) {
    const charInPlay = player.characters[charId];
    const charDef = state.cardPool[charInPlay.definitionId as string];
    logDetail(`Corruption check available for '${charDef?.name ?? charId}'`);
    actions.push({
      type: 'corruption-check',
      player: playerId,
      characterId: charId as CardInstanceId,
    });
  }

  actions.push({ type: 'pass', player: playerId });
  return actions;
}
