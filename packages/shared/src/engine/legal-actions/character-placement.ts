/**
 * @module legal-actions/character-placement
 *
 * Legal actions during the character placement step. Each player assigns
 * their drafted characters to one of their starting companies.
 */

import type { GameState, PlayerId, GameAction } from '../../index.js';
import { setupStepContext } from '../../state-utils.js';
import { SetupStep } from '../../types/state-phases.js';
import { characterIds, defById } from '../reducer-utils.js';
import { logDetail } from './log.js';

export function characterPlacementActions(state: GameState, playerId: PlayerId): GameAction[] {
  const ctx = setupStepContext(state, playerId, SetupStep.CharacterPlacement);
  if (!ctx) return [];
  const { step: stepState, playerIndex } = ctx;

  if (stepState.placementDone[playerIndex]) {
    logDetail(`Player already finished placement`);
    return [];
  }

  const player = state.players[playerIndex];
  const charCount = Object.keys(player.characters).length;
  const companyCount = player.companies.length;
  logDetail(`${charCount} character(s) to place across ${companyCount} company/companies`);

  const actions: GameAction[] = [];

  // For each character, offer placing in any company they're not already in.
  // A character that has already been placed this step is not offered again:
  // placement is monotonic so it cannot cycle (which previously let AI players
  // shuffle characters between companies indefinitely). Its single placement is
  // final, and every company was offered as a target, so all valid partitions
  // are still reachable.
  const alreadyPlaced = stepState.placed[playerIndex];
  for (const charId of characterIds(player)) {
    if (alreadyPlaced.includes(charId)) continue;

    const charInPlay = player.characters[charId];
    const charDef = defById(state, charInPlay.definitionId);
    const charName = charDef?.name ?? charId;
    const currentCompanyId = player.companies.find(c =>
      c.characters.includes(charId))?.id;

    logDetail(`Character '${charName}' currently in company ${currentCompanyId as string ?? 'none'}`);

    for (const company of player.companies) {
      if (company.id === currentCompanyId) continue;
      logDetail(`  Can move '${charName}' → company ${company.id as string}`);
      actions.push({
        type: 'place-character',
        player: playerId,
        characterInstanceId: charId,
        companyId: company.id,
      });
    }
  }

  // Can pass when done placing
  actions.push({ type: 'pass', player: playerId });

  return actions;
}
