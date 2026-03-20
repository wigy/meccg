/**
 * @module legal-actions/starting-site-selection
 *
 * Legal actions during the starting site selection step. Each player
 * selects one or two sites from their site deck to form initial companies.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { getAlignmentRules } from '@meccg/shared';
import { logDetail } from './log.js';

export function startingSiteSelectionActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'starting-site-selection') return [];

  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const siteSelection = state.phaseState.setupStep.siteSelectionState[playerIndex];

  if (siteSelection.done) {
    logDetail(`Player already finished site selection`);
    return [];
  }

  const player = state.players[playerIndex];
  const { defaultStartingSites, maxStartingSites } = getAlignmentRules(player.alignment);
  const allowedDefIds = new Set(defaultStartingSites.map(id => id as string));

  logDetail(`Selected ${siteSelection.selectedSites.length}/${maxStartingSites} sites, ${player.siteDeck.length} in site deck, ${allowedDefIds.size} allowed starting site def(s)`);

  const actions: GameAction[] = [];

  // Offer sites from site deck that match the alignment's allowed starting sites
  if (siteSelection.selectedSites.length < maxStartingSites) {
    for (const siteInstId of player.siteDeck) {
      if (siteSelection.selectedSites.includes(siteInstId)) continue;
      const inst = state.instanceMap[siteInstId as string];
      if (!inst) {
        logDetail(`Skipping site instance ${siteInstId as string}: not found in instance map`);
        continue;
      }
      if (!allowedDefIds.has(inst.definitionId as string)) {
        const siteDef = state.cardPool[inst.definitionId as string];
        logDetail(`Skipping site '${siteDef?.name ?? inst.definitionId as string}': not in allowed starting sites`);
        continue;
      }
      const siteDef = state.cardPool[inst.definitionId as string];
      logDetail(`Eligible starting site: '${siteDef?.name ?? inst.definitionId as string}'`);
      actions.push({ type: 'select-starting-site', player: playerId, siteInstanceId: siteInstId });
    }
  } else {
    logDetail(`Already at max starting sites (${maxStartingSites})`);
  }

  // Can pass if at least one site is selected
  if (siteSelection.selectedSites.length > 0) {
    actions.push({ type: 'pass', player: playerId });
  } else {
    logDetail(`Cannot pass: no sites selected yet`);
  }

  return actions;
}
