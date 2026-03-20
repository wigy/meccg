/**
 * @module legal-actions/character-placement
 *
 * Legal actions during the character placement step. Each player assigns
 * their drafted characters to one of their starting companies, then
 * shuffles their play deck.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { HAND_SIZE } from '@meccg/shared';

export function characterPlacementActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'character-placement') return [];

  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const stepState = state.phaseState.setupStep;

  if (stepState.drawn[playerIndex]) return [];

  // After shuffle, draw initial hand
  if (stepState.shuffled[playerIndex]) {
    return [{ type: 'draw-cards', player: playerId, count: HAND_SIZE }];
  }

  // After placement done, must shuffle
  if (stepState.placementDone[playerIndex]) {
    return [{ type: 'shuffle-play-deck', player: playerId }];
  }

  const player = state.players[playerIndex];
  const actions: GameAction[] = [];

  // For each character, offer placing in any company they're not already in
  for (const charId of Object.keys(player.characters)) {
    const currentCompanyId = player.companies.find(c =>
      c.characters.includes(charId as never))?.id;

    for (const company of player.companies) {
      if (company.id === currentCompanyId) continue;
      actions.push({
        type: 'place-character',
        player: playerId,
        characterInstanceId: charId as never,
        companyId: company.id,
      });
    }
  }

  // Can pass when done placing
  actions.push({ type: 'pass', player: playerId });

  return actions;
}
