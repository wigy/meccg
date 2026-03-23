/**
 * @module legal-actions/site
 *
 * Legal actions during the site phase. Companies at non-haven sites
 * resolve automatic attacks and may play resource cards (items,
 * factions, allies).
 */

import type { GameState, PlayerId, GameAction } from '../../index.js';
import { logDetail } from './log.js';

export function siteActions(state: GameState, playerId: PlayerId): GameAction[] {
  // TODO: play-hero-resource, influence-attempt, play-minor-item, corruption-check
  const isActive = state.activePlayer === playerId;
  logDetail(`Site phase: player is ${isActive ? 'active' : 'non-active'}`);

  if (!isActive) {
    logDetail(`Not active player, no site actions`);
    return [];
  }

  return [{ type: 'pass', player: playerId }];
}
