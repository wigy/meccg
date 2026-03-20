/**
 * @module legal-actions/character-placement
 *
 * Legal actions during the character placement step. Each player assigns
 * their drafted characters to one of their starting companies.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';

export function characterPlacementActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'character-placement') return [];

  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  if (state.phaseState.setupStep.placementDone[playerIndex]) return [];

  const player = state.players[playerIndex];
  const actions: GameAction[] = [];

  // For each character, offer placing in any company they're not already in
  for (const charId of Object.keys(player.characters)) {
    // Find which company this character is currently in
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

  // Can pass when done placing (all characters are somewhere)
  actions.push({ type: 'pass', player: playerId });

  return actions;
}
