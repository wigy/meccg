/**
 * @module legal-actions/end-of-turn
 *
 * Legal actions during the end-of-turn phase. The active player draws
 * or discards to reach hand size and may call the Free Council to
 * trigger the endgame.
 */

import type { GameState, PlayerId, GameAction } from '@meccg/shared';
import { HAND_SIZE } from '@meccg/shared';
import { logDetail } from './log.js';

export function endOfTurnActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.activePlayer !== playerId) {
    logDetail(`Not active player, no end-of-turn actions`);
    return [];
  }

  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];

  logDetail(`Hand size: ${player.hand.length}, target: ${HAND_SIZE}, deck size: ${player.playDeck.length}`);

  const actions: GameAction[] = [];

  // Draw cards if hand is below HAND_SIZE
  if (player.hand.length < HAND_SIZE && player.playDeck.length > 0) {
    const count = Math.min(HAND_SIZE - player.hand.length, player.playDeck.length);
    logDetail(`Must draw ${count} card(s) to reach hand size`);
    actions.push({ type: 'draw-cards', player: playerId, count });
  }

  // Discard cards if hand is above HAND_SIZE
  if (player.hand.length > HAND_SIZE) {
    logDetail(`Must discard ${player.hand.length - HAND_SIZE} card(s) to reach hand size, ${player.hand.length} choices`);
    for (const cardId of player.hand) {
      actions.push({ type: 'discard-card', player: playerId, cardInstanceId: cardId });
    }
  }

  // Call Free Council if eligible
  if (player.deckExhaustionCount >= 1) {
    logDetail(`Deck exhausted ${player.deckExhaustionCount} time(s) → can call Free Council`);
    // TODO: check MP threshold — needs scoring module
    actions.push({ type: 'call-free-council', player: playerId });
  }

  actions.push({ type: 'pass', player: playerId });
  return actions;
}
