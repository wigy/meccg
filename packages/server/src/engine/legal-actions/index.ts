/**
 * @module legal-actions
 *
 * Computes the complete list of concrete legal actions a player can take
 * given the current game state. Each phase has its own module under this
 * directory. This index dispatches to the appropriate phase module.
 *
 * The function is pure: `(GameState, PlayerId) → GameAction[]`.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { draftActions } from './draft.js';
import { itemDraftActions } from './item-draft.js';
import { untapActions } from './untap.js';
import { organizationActions } from './organization.js';
import { longEventActions } from './long-event.js';
import { movementHazardActions } from './movement-hazard.js';
import { siteActions } from './site.js';
import { endOfTurnActions } from './end-of-turn.js';
import { freeCouncilActions } from './free-council.js';

/**
 * Returns every concrete action the given player can legally submit
 * in the current game state. Each returned action is a complete
 * {@link GameAction} with all fields populated.
 */
export function computeLegalActions(state: GameState, playerId: PlayerId): GameAction[] {
  switch (state.phaseState.phase) {
    case 'character-draft':   return draftActions(state, playerId);
    case 'item-draft':        return itemDraftActions(state, playerId);
    case 'untap':             return untapActions(state, playerId);
    case 'organization':      return organizationActions(state, playerId);
    case 'long-event':        return longEventActions(state, playerId);
    case 'movement-hazard':   return movementHazardActions(state, playerId);
    case 'site':              return siteActions(state, playerId);
    case 'end-of-turn':       return endOfTurnActions(state, playerId);
    case 'free-council':      return freeCouncilActions(state, playerId);
    case 'game-over':         return [];
    default:                  return [];
  }
}
