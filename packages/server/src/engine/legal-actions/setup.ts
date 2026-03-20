/**
 * @module legal-actions/setup
 *
 * Legal actions during the pre-game setup phase. Delegates to the
 * appropriate step handler based on the current setup step.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { draftActions } from './draft.js';
import { itemDraftActions } from './item-draft.js';
import { characterDeckDraftActions } from './character-deck-draft.js';
import { startingSiteSelectionActions } from './starting-site-selection.js';
import { characterPlacementActions } from './character-placement.js';

export function setupActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'setup') return [];

  switch (state.phaseState.setupStep.step) {
    case 'character-draft':         return draftActions(state, playerId);
    case 'item-draft':              return itemDraftActions(state, playerId);
    case 'character-deck-draft':    return characterDeckDraftActions(state, playerId);
    case 'starting-site-selection': return startingSiteSelectionActions(state, playerId);
    case 'character-placement':     return characterPlacementActions(state, playerId);
    default:                        return [];
  }
}
