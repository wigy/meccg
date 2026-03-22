/**
 * @module legal-actions/untap
 *
 * Legal actions during the untap phase. The engine handles untapping
 * automatically; the player just confirms advancement with pass.
 * Hand cards are annotated as not playable during this phase.
 */

import type { GameState, PlayerId, EvaluatedAction } from '@meccg/shared';
import { Phase } from '@meccg/shared';
import { logDetail } from './log.js';

export function untapActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  if (state.phaseState.phase !== Phase.Untap) return [];

  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  if (state.activePlayer === playerId) {
    actions.push({ action: { type: 'pass', player: playerId }, viable: true });
    logDetail(`Untap phase: pass available for player ${playerId as string}`);
  } else {
    logDetail(`Untap phase: player ${playerId as string} is not the active player`);
  }

  for (const cardInstanceId of player.hand) {
    actions.push({
      action: { type: 'not-playable', player: playerId, cardInstanceId },
      viable: false,
      reason: 'Cards cannot be played during the untap phase',
    });
  }
  logDetail(`Untap phase: ${player.hand.length} hand card(s) marked not playable`);

  return actions;
}
