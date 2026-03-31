/**
 * @module legal-actions/item-draft
 *
 * Legal actions during the item draft phase. Each player assigns their
 * starting minor items to any character in their starting company.
 *
 * Uses the rules engine so that non-item cards (drafted characters) appear
 * as non-viable with an explanation, giving the UI a complete picture of
 * the pool.
 */

import type { GameState, PlayerId, EvaluatedAction } from '../../index.js';
import { isItemCard, isCharacterCard, evaluateAction, ITEM_DRAFT_RULES, MAX_STARTING_ITEMS, getPlayerIndex } from '../../index.js';
import { logDetail } from './log.js';

export function itemDraftActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'item-draft') return [];

  const playerIndex = getPlayerIndex(state, playerId);
  const itemDraft = state.phaseState.setupStep.itemDraftState[playerIndex];

  if (itemDraft.done) {
    logDetail(`Player already finished item assignment`);
    return [];
  }

  const player = state.players[playerIndex];
  const allCharIds = player.companies.flatMap(c => c.characters);
  const assignedCount = Object.values(player.characters).reduce(
    (sum, char) => sum + char.items.length, 0,
  );
  logDetail(`${itemDraft.unassignedItems.length} unassigned item(s), ${assignedCount}/${MAX_STARTING_ITEMS} assigned, ${allCharIds.length} character(s) available`);

  const evaluated: EvaluatedAction[] = [];

  // Emit non-viable entries for drafted characters (they're in companies, not assignable)
  for (const charInstId of allCharIds) {
    const charInPlay = player.characters[charInstId as string];
    if (!charInPlay) continue;
    const def = state.cardPool[charInPlay.definitionId as string];
    if (!def || !isCharacterCard(def)) continue;

    const context = { card: { name: def.name, isItem: false, unique: false }, ctx: { assignedCount, maxStartingItems: MAX_STARTING_ITEMS } };
    // Use a dummy action — the character isn't an item, so this is always rejected
    const action = { type: 'assign-starting-item' as const, player: playerId, itemDefId: charInPlay.definitionId, characterInstanceId: charInstId };
    const result = evaluateAction(action, ITEM_DRAFT_RULES, context);
    logDetail(`${def.name}: ${result.reason}`);
    evaluated.push(result);
  }

  // Emit non-viable entries for already-assigned items (on characters)
  for (const char of Object.values(player.characters)) {
    for (const item of char.items) {
      const def = state.cardPool[item.definitionId as string];
      if (!def) continue;
      const action = { type: 'assign-starting-item' as const, player: playerId, itemDefId: item.definitionId, characterInstanceId: char.instanceId };
      evaluated.push({ action, viable: false, reason: `${def.name} is already assigned` });
      logDetail(`${def.name}: already assigned`);
    }
  }

  // Unassigned items: evaluate each through the rules engine
  const seenDefIds = new Set<string>();
  for (const itemCard of itemDraft.unassignedItems) {
    const defId = itemCard.definitionId;
    if (seenDefIds.has(defId as string)) {
      logDetail(`Skipping duplicate item instance ${itemCard.instanceId as string} (defId ${defId as string} already offered)`);
      continue;
    }
    seenDefIds.add(defId as string);
    const itemDef = state.cardPool[defId as string];
    const itemName = itemDef ? itemDef.name : defId as string;
    const isItem = isItemCard(itemDef);

    const context = {
      card: {
        name: itemName,
        isItem,
        unique: isItem ? itemDef.unique : false,
      },
      ctx: {
        assignedCount,
        maxStartingItems: MAX_STARTING_ITEMS,
      },
    };

    // Evaluate against first character to get viability; if non-viable, emit one rejected entry
    const probeAction = { type: 'assign-starting-item' as const, player: playerId, itemDefId: defId, characterInstanceId: allCharIds[0] };
    const result = evaluateAction(probeAction, ITEM_DRAFT_RULES, context);

    if (!result.viable) {
      logDetail(`${itemName}: ${result.reason}`);
      evaluated.push(result);
      continue;
    }

    logDetail(`Item '${itemName}' can be assigned to ${allCharIds.length} character(s)`);
    for (const charId of allCharIds) {
      evaluated.push({
        action: { type: 'assign-starting-item', player: playerId, itemDefId: defId, characterInstanceId: charId },
        viable: true,
      });
    }
  }

  // Can always pass
  evaluated.push({ action: { type: 'pass', player: playerId }, viable: true });

  return evaluated;
}
