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

  // Deduplicate by definition ID: multiple instances of the same item
  // (e.g. two Daggers of Westernesse) produce only one action per character.
  const seenDefIds = new Set<string>();
  const actions: GameAction[] = [];
  for (const itemId of itemDraft.unassignedItems) {
    const inst = state.instanceMap[itemId as string];
    if (!inst) continue;
    const defId = inst.definitionId;
    if (seenDefIds.has(defId as string)) continue;
    seenDefIds.add(defId as string);
    for (const charId of allCharIds) {
      actions.push({
        type: 'assign-starting-item',
        player: playerId,
        itemDefId: defId,
        characterInstanceId: charId,
      });
    }
  }

  // Can always pass (skip remaining item assignments)
  actions.push({ type: 'pass', player: playerId });

  return actions;
}
