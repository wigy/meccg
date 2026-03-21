/**
 * @module legal-actions/deck-shuffle
 *
 * Legal actions during the deck shuffle step. Each player shuffles
 * their play deck before drawing their initial hand.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { getPlayerIndex } from '@meccg/shared';
import { logDetail } from './log.js';

export function deckShuffleActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'deck-shuffle') return [];

  const playerIndex = getPlayerIndex(state, playerId);
  const stepState = state.phaseState.setupStep;

  if (stepState.shuffled[playerIndex]) {
    logDetail(`Player already shuffled`);
    return [];
  }

  logDetail(`Must shuffle play deck`);
  return [{ type: 'shuffle-play-deck', player: playerId }];
}
