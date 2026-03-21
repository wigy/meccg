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
import { deckShuffleActions } from './deck-shuffle.js';
import { initialDrawActions } from './initial-draw.js';
import { initiativeRollActions } from './initiative-roll.js';
import { logDetail } from './log.js';

export function setupActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'setup') return [];

  const step = state.phaseState.setupStep.step;
  logDetail(`Setup step: '${step}'`);

  switch (step) {
    case 'character-draft':         return draftActions(state, playerId);
    case 'item-draft':              return itemDraftActions(state, playerId);
    case 'character-deck-draft':    return characterDeckDraftActions(state, playerId);
    case 'starting-site-selection': return startingSiteSelectionActions(state, playerId);
    case 'character-placement':     return characterPlacementActions(state, playerId);
    case 'deck-shuffle':            return deckShuffleActions(state, playerId);
    case 'initial-draw':            return initialDrawActions(state, playerId);
    case 'initiative-roll':         return initiativeRollActions(state, playerId);
    default:                        return [];
  }
}
