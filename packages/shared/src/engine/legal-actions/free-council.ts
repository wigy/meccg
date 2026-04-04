/**
 * @module legal-actions/free-council
 *
 * Legal actions during the Free Council (endgame) phase. All characters
 * must make corruption checks before final marshalling points are tallied.
 * Each player performs corruption checks in turn, starting with the player
 * who took the last turn. Characters already checked are tracked in
 * the phase state's `checkedCharacters` array.
 */

import type { GameState, PlayerId, GameAction, CardInstanceId, FreeCouncilPhaseState } from '../../index.js';
import { isCharacterCard } from '../../index.js';
import { logDetail } from './log.js';

export function freeCouncilActions(state: GameState, playerId: PlayerId): GameAction[] {
  const fcState = state.phaseState as FreeCouncilPhaseState;

  if (fcState.step === 'done') {
    return [];
  }

  // Only the current player performs corruption checks
  if (playerId !== fcState.currentPlayer) {
    return [];
  }

  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];

  const checked = new Set(fcState.checkedCharacters);
  const actions: GameAction[] = [];

  // Corruption check for each unchecked character in play
  for (const charId of Object.keys(player.characters)) {
    if (checked.has(charId)) continue;
    const charInPlay = player.characters[charId];
    const charDef = state.cardPool[charInPlay.definitionId as string];
    const cp = charInPlay.effectiveStats.corruptionPoints;
    const modifier = charDef && isCharacterCard(charDef) ? charDef.corruptionModifier : 0;
    const possessions: CardInstanceId[] = [
      ...charInPlay.items.map(i => i.instanceId),
      ...charInPlay.allies.map(a => a.instanceId),
      ...charInPlay.hazards.map(h => h.instanceId),
    ];
    const ccNeed = cp + 1 - modifier;
    const ccParts = [`CP ${cp}`];
    if (modifier !== 0) ccParts.push(`modifier ${modifier >= 0 ? '+' : ''}${modifier}`);
    logDetail(`Corruption check available for '${charDef?.name ?? charId}' (CP ${cp}, modifier ${modifier >= 0 ? '+' : ''}${modifier})`);
    actions.push({
      type: 'corruption-check',
      player: playerId,
      characterId: charId as CardInstanceId,
      corruptionPoints: cp,
      corruptionModifier: modifier,
      possessions,
      need: ccNeed,
      explanation: `Need roll > ${cp - modifier} (${ccParts.join(', ')})`,
    });
  }

  // Pass advances to scoring only after all characters have been checked
  if (actions.length === 0) {
    actions.push({ type: 'pass', player: playerId });
    logDetail('Free Council: all characters checked, pass available');
  } else {
    logDetail(`Free Council: ${actions.length} character(s) available for corruption checks`);
  }
  return actions;
}
