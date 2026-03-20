/**
 * @module legal-actions/starting-site-selection
 *
 * Legal actions during the starting site selection step. Each player
 * selects one or two sites from their site deck to form initial companies.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { getAlignmentRules } from '@meccg/shared';

export function startingSiteSelectionActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'starting-site-selection') return [];

  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const siteSelection = state.phaseState.setupStep.siteSelectionState[playerIndex];

  if (siteSelection.done) return [];

  const player = state.players[playerIndex];
  const { defaultStartingSites, maxStartingSites } = getAlignmentRules(player.alignment);
  const allowedDefIds = new Set(defaultStartingSites.map(id => id as string));

  const actions: GameAction[] = [];

  // Offer sites from site deck that match the alignment's allowed starting sites
  if (siteSelection.selectedSites.length < maxStartingSites) {
    for (const siteInstId of player.siteDeck) {
      if (siteSelection.selectedSites.includes(siteInstId)) continue;
      const inst = state.instanceMap[siteInstId as string];
      if (!inst || !allowedDefIds.has(inst.definitionId as string)) continue;
      actions.push({ type: 'select-starting-site', player: playerId, siteInstanceId: siteInstId });
    }
  }

  // Can pass if at least one site is selected
  if (siteSelection.selectedSites.length > 0) {
    actions.push({ type: 'pass', player: playerId });
  }

  return actions;
}
