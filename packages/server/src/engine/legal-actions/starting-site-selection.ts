/**
 * @module legal-actions/starting-site-selection
 *
 * Legal actions during the starting site selection step. Each player
 * selects one or two sites from their site deck to form initial companies.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';

/** Maximum number of starting sites a player can select. */
const MAX_STARTING_SITES = 2;

export function startingSiteSelectionActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'starting-site-selection') return [];

  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const siteSelection = state.phaseState.setupStep.siteSelectionState[playerIndex];

  if (siteSelection.done) return [];

  const actions: GameAction[] = [];
  const player = state.players[playerIndex];

  // Offer each site in the site deck that hasn't been selected yet
  if (siteSelection.selectedSites.length < MAX_STARTING_SITES) {
    for (const siteInstId of player.siteDeck) {
      if (siteSelection.selectedSites.includes(siteInstId)) continue;
      actions.push({ type: 'select-starting-site', player: playerId, siteInstanceId: siteInstId });
    }
  }

  // Can pass if at least one site is selected
  if (siteSelection.selectedSites.length > 0) {
    actions.push({ type: 'pass', player: playerId });
  }

  return actions;
}
