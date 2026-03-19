/**
 * @module legal-actions/item-draft
 *
 * Legal actions during the item draft phase. Each player assigns their
 * starting minor items to any character in their starting company.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';

export function itemDraftActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'item-draft') return [];

  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const itemDraft = state.phaseState.itemDraftState[playerIndex];

  if (itemDraft.done) return [];

  const player = state.players[playerIndex];
  const allCharIds = player.companies.flatMap(c => c.characters);

  const actions: GameAction[] = [];
  for (const itemId of itemDraft.unassignedItems) {
    for (const charId of allCharIds) {
      actions.push({
        type: 'assign-starting-item',
        player: playerId,
        itemInstanceId: itemId,
        characterInstanceId: charId,
      });
    }
  }

  return actions;
}
