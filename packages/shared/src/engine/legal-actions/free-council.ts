/**
 * @module legal-actions/free-council
 *
 * Legal actions during the Free Council (endgame) phase. All characters
 * must make corruption checks before final marshalling points are tallied.
 * Each player performs corruption checks in turn, starting with the player
 * who took the last turn. Characters already checked are tracked in
 * the phase state's `checkedCharacters` array.
 *
 * Per CoE rule 7.1.1, after a corruption check is declared but before it
 * resolves, other untapped characters in the same company may tap for
 * +1 support each. This is handled via the `pendingCheck` sub-state.
 */

import type { GameState, PlayerId, GameAction, CardInstanceId, FreeCouncilPhaseState } from '../../index.js';
import { isCharacterCard, CardStatus } from '../../index.js';
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

  // If a corruption check is pending (awaiting support), offer support actions
  if (fcState.pendingCheck) {
    return supportActions(state, playerId, fcState);
  }

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

/**
 * Computes support actions for a pending corruption check.
 *
 * Eligible supporters are untapped characters in the same company as the
 * character making the check (excluding the check target itself).
 * Each tapped supporter adds +1 to the roll (CoE rule 7.1.1).
 * Pass is always available to resolve the check without further support.
 */
function supportActions(
  state: GameState,
  playerId: PlayerId,
  fcState: FreeCouncilPhaseState,
): GameAction[] {
  const pending = fcState.pendingCheck!;
  const player = state.players.find(p => p.id === playerId)!;
  const actions: GameAction[] = [];

  // Find the company containing the character making the check
  const company = player.companies.find(c => c.characters.includes(pending.characterId));
  if (company) {
    for (const charId of company.characters) {
      if (charId === pending.characterId) continue;
      const charInPlay = player.characters[charId as string];
      if (!charInPlay) continue;
      if (charInPlay.status !== CardStatus.Untapped) continue;

      const charDef = state.cardPool[charInPlay.definitionId as string];
      const charName = charDef?.name ?? (charId as string);
      logDetail(`Support available: ${charName} can tap for +1 to corruption check`);
      actions.push({
        type: 'support-corruption-check',
        player: playerId,
        supportingCharacterId: charId,
      });
    }
  }

  logDetail(`Corruption check support: ${actions.length} supporter(s) available, pass to resolve`);
  // Pass resolves the pending check with accumulated support
  actions.push({ type: 'pass', player: playerId });
  return actions;
}
