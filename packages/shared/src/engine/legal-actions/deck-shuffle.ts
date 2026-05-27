/**
 * @module legal-actions/deck-shuffle
 *
 * Legal actions during the deck shuffle step. Each player shuffles
 * their play deck before drawing their initial hand.
 */

import type { GameState, PlayerId, GameAction } from '../../index.js';
import { SetupStep, setupStepContext } from '../../index.js';
import { logDetail } from './log.js';

export function deckShuffleActions(state: GameState, playerId: PlayerId): GameAction[] {
  const ctx = setupStepContext(state, playerId, SetupStep.DeckShuffle);
  if (!ctx) return [];
  const { step: stepState, playerIndex } = ctx;

  if (stepState.shuffled[playerIndex]) {
    logDetail(`Player already shuffled`);
    return [];
  }

  logDetail(`Must shuffle play deck`);
  return [{ type: 'shuffle-play-deck', player: playerId }];
}
