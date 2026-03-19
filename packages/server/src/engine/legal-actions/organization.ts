/**
 * @module legal-actions/organization
 *
 * Legal actions during the organization phase. The active player can
 * reorganize companies, recruit characters, transfer items, and plan
 * movement for the upcoming movement/hazard phase.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';

export function organizationActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.activePlayer !== playerId) return [];

  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];

  const actions: GameAction[] = [];

  // Cancel movement for companies with planned destinations
  for (const company of player.companies) {
    if (company.destinationSite !== null) {
      actions.push({ type: 'cancel-movement', player: playerId, companyId: company.id });
    }
  }

  // TODO: play-character, split-company, merge-companies, transfer-item, plan-movement

  actions.push({ type: 'pass', player: playerId });
  return actions;
}
