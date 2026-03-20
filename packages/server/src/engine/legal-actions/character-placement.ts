/**
 * @module legal-actions/character-placement
 *
 * Legal actions during the character placement step. Each player assigns
 * their drafted characters to one of their starting companies, then
 * shuffles their play deck.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { HAND_SIZE } from '@meccg/shared';
import { logDetail } from './log.js';

export function characterPlacementActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'character-placement') return [];

  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const stepState = state.phaseState.setupStep;

  if (stepState.drawn[playerIndex]) {
    logDetail(`Player already drew initial hand`);
    return [];
  }

  // After shuffle, draw initial hand
  if (stepState.shuffled[playerIndex]) {
    logDetail(`Deck shuffled, must draw initial hand (${HAND_SIZE} cards)`);
    return [{ type: 'draw-cards', player: playerId, count: HAND_SIZE }];
  }

  // After placement done, must shuffle
  if (stepState.placementDone[playerIndex]) {
    logDetail(`Placement done, must shuffle play deck`);
    return [{ type: 'shuffle-play-deck', player: playerId }];
  }

  const player = state.players[playerIndex];
  const charCount = Object.keys(player.characters).length;
  const companyCount = player.companies.length;
  logDetail(`${charCount} character(s) to place across ${companyCount} company/companies`);

  const actions: GameAction[] = [];

  // For each character, offer placing in any company they're not already in
  for (const charId of Object.keys(player.characters)) {
    const charInPlay = player.characters[charId];
    const charDef = state.cardPool[charInPlay.definitionId as string];
    const charName = charDef?.name ?? charId;
    const currentCompanyId = player.companies.find(c =>
      c.characters.includes(charId as never))?.id;

    logDetail(`Character '${charName}' currently in company ${currentCompanyId as string ?? 'none'}`);

    for (const company of player.companies) {
      if (company.id === currentCompanyId) continue;
      logDetail(`  Can move '${charName}' → company ${company.id as string}`);
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
