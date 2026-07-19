/**
 * @module legal-actions/item-draft
 *
 * Legal actions during the item draft phase. Each player assigns their
 * starting minor items to any character in their starting company.
 */

import type { GameState, PlayerId, EvaluatedAction } from '../../index.js';
import type { CardEffect } from '../../types/effects.js';
import { ITEM_DRAFT_RULES, MAX_STARTING_ITEMS } from '../../rules/definitions/item-draft.js';
import { evaluateAction } from '../../rules/evaluator.js';
import { setupStepContext } from '../../state-utils.js';
import { isItemCard } from '../../types/cards.js';
import { SetupStep } from '../../types/state-phases.js';
import { hasPlayFlag } from '../../effects/play-flags.js';
import { logDetail } from './log.js';
import { defById, countStartingMinorItems, hasAgentSummonsEffect, isAgentCharacter } from '../reducer-utils.js';

export function itemDraftActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const ctx = setupStepContext(state, playerId, SetupStep.ItemDraft);
  if (!ctx) return [];
  const { step: setupStep, playerIndex } = ctx;
  const itemDraft = setupStep.itemDraftState[playerIndex];

  if (itemDraft.done) {
    logDetail(`Player already finished item assignment`);
    return [];
  }

  const player = state.players[playerIndex];
  const allCharIds = player.companies.flatMap(c => c.characters);
  // Only true minor items count toward the two-item budget; Stage resources
  // placed with a character (e.g. Thrall of the Voice) do not (CoE 1.7.F1 /
  // 1.9.F4 — see countStartingMinorItems).
  const assignedCount = countStartingMinorItems(state, player);
  logDetail(`${itemDraft.unassignedItems.length} unassigned item(s), ${assignedCount}/${MAX_STARTING_ITEMS} minor item(s) assigned, ${allCharIds.length} character(s) available`);

  const evaluated: EvaluatedAction[] = [];
  if (allCharIds.length === 0) return evaluated;

  // Emit non-viable entries for already-assigned items (on characters)
  for (const char of Object.values(player.characters)) {
    for (const item of char.items) {
      const def = defById(state, item.definitionId);
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
    const itemDef = defById(state, defId);
    const itemName = itemDef ? itemDef.name : defId as string;
    const isItem = isItemCard(itemDef);

    const isHoard = isItem && (itemDef.keywords ?? []).includes('hoard');
    const noStartingCompany = isItemCard(itemDef) && hasPlayFlag(itemDef, 'no-starting-company');
    const context = {
      card: {
        name: itemName,
        isItem,
        unique: isItem ? itemDef.unique : false,
        isHoard,
        noStartingCompany,
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

  // Offer starting-company-event placements. Cards "played with a starting
  // company in lieu of a minor item" normally sit in the play deck (Open to the
  // Summons wh-46, Orders from Lugbúrz as-94). Balrog-specific ones (Gangways
  // over the Fire ba-60, Orders from the Great Demon ba-70) are resource-events
  // with the `starting-item` keyword, so any left in the starting-company pool
  // are sunk to the sideboard during setup — scan there as well so they are
  // still offered rather than vanishing from the starting company.
  if (assignedCount < MAX_STARTING_ITEMS) {
    const seenEventDefIds = new Set<string>();
    for (const deckCard of [...player.playDeck, ...player.sideboard]) {
      const defId = deckCard.definitionId;
      if (seenEventDefIds.has(defId as string)) continue;
      const def = defById(state, defId);
      const isItem = isItemCard(def);
      const effects = isItem ? [] : ((def as { effects?: readonly CardEffect[] } | undefined)?.effects ?? []);
      if (!effects.some(e => e.type === 'starting-company-placement')) continue;
      seenEventDefIds.add(defId as string);
      // Recruitment vehicle (Thrall of the Voice, wh-82) is "placed with a
      // character": offer one placement per character in the starting company,
      // so it attaches to that character and reduces its mind. Open to the
      // Summons (wh-46) is an agent-summons vehicle — it may only be placed with
      // an agent character ("place this card with the agent").
      const isRecruitmentVehicle = effects.some(e => e.type === 'recruitment-vehicle');
      const agentOnly = hasAgentSummonsEffect(def);
      for (const company of player.companies) {
        // Skip if already placed on this company
        const alreadyOnCompany = player.cardsInPlay.some(
          c => c.companyId === company.id && c.definitionId === defId,
        );
        if (alreadyOnCompany) continue;
        if (isRecruitmentVehicle) {
          const eligibleChars = company.characters.filter(
            charId => !agentOnly || isAgentCharacter(defById(state, player.characters[charId]?.definitionId)),
          );
          for (const charId of eligibleChars) {
            evaluated.push({
              action: { type: 'place-starting-company-event', player: playerId, cardDefId: defId, companyId: company.id, targetCharacterInstanceId: charId },
              viable: true,
            });
          }
          logDetail(`Recruitment vehicle '${def?.name ?? defId as string}' offered for ${eligibleChars.length} character(s) in company ${company.id as string}${agentOnly ? ' (agents only)' : ''}`);
        } else {
          evaluated.push({
            action: { type: 'place-starting-company-event', player: playerId, cardDefId: defId, companyId: company.id },
            viable: true,
          });
          logDetail(`Starting company event '${def?.name ?? defId as string}' offered for company ${company.id as string}`);
        }
      }
    }
  }

  // Can always pass
  evaluated.push({ action: { type: 'pass', player: playerId }, viable: true });

  return evaluated;
}
