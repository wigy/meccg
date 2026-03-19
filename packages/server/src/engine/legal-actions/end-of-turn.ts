/**
 * @module legal-actions/end-of-turn
 *
 * Legal actions during the end-of-turn phase. The active player draws
 * or discards to reach hand size and may call the Free Council to
 * trigger the endgame.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { HAND_SIZE } from '@meccg/shared';

export function endOfTurnActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.activePlayer !== playerId) return [];

  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];

  const actions: GameAction[] = [];

  // Draw cards if hand is below HAND_SIZE
  if (player.hand.length < HAND_SIZE && player.playDeck.length > 0) {
    const count = Math.min(HAND_SIZE - player.hand.length, player.playDeck.length);
    actions.push({ type: 'draw-cards', player: playerId, count });
  }

  // Discard cards if hand is above HAND_SIZE
  if (player.hand.length > HAND_SIZE) {
    for (const cardId of player.hand) {
      actions.push({ type: 'discard-card', player: playerId, cardInstanceId: cardId });
    }
  }

  // Call Free Council if eligible
  if (player.deckExhaustionCount >= 1) {
    // TODO: check MP threshold — needs scoring module
    actions.push({ type: 'call-free-council', player: playerId });
  }

  actions.push({ type: 'pass', player: playerId });
  return actions;
}
