/**
 * @module legal-actions/setup
 *
 * Legal actions during the pre-game setup phase. Delegates to the
 * appropriate step handler based on the current setup step.
 *
 * Setup steps that use the rules engine return {@link EvaluatedAction} with
 * viability annotations. Steps without rules (deck-shuffle, initial-draw, etc.)
 * return plain actions wrapped as viable.
 */

import type { GameState, PlayerId, GameAction, EvaluatedAction } from '@meccg/shared';
import { draftActions } from './draft.js';
import { itemDraftActions } from './item-draft.js';
import { characterDeckDraftActions } from './character-deck-draft.js';
import { startingSiteSelectionActions } from './starting-site-selection.js';
import { characterPlacementActions } from './character-placement.js';
import { deckShuffleActions } from './deck-shuffle.js';
import { initialDrawActions } from './initial-draw.js';
import { initiativeRollActions } from './initiative-roll.js';
import { logDetail } from './log.js';

/** Wraps plain GameActions as viable EvaluatedActions. */
function asViable(actions: GameAction[]): EvaluatedAction[] {
  return actions.map(action => ({ action, viable: true }));
}

export function setupActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  if (state.phaseState.phase !== 'setup') return [];

  const step = state.phaseState.setupStep.step;
  logDetail(`Setup step: '${step}'`);

  switch (step) {
    case 'character-draft':         return draftActions(state, playerId);
    case 'item-draft':              return asViable(itemDraftActions(state, playerId));
    case 'character-deck-draft':    return characterDeckDraftActions(state, playerId);
    case 'starting-site-selection': return startingSiteSelectionActions(state, playerId);
    case 'character-placement':     return asViable(characterPlacementActions(state, playerId));
    case 'deck-shuffle':            return asViable(deckShuffleActions(state, playerId));
    case 'initial-draw':            return asViable(initialDrawActions(state, playerId));
    case 'initiative-roll':         return asViable(initiativeRollActions(state, playerId));
    default:                        return [];
  }
}
