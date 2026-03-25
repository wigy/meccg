/**
 * @module legal-actions/chain
 *
 * Computes legal actions when a chain of effects is active.
 *
 * When `state.chain` is non-null, {@link computeLegalActions} delegates here
 * instead of to the phase-specific handler. This module determines what the
 * priority player can declare in response (playable cards, pass) while
 * respecting the chain's restriction mode.
 *
 * During the `'resolving'` mode, no player actions are needed — the reducer
 * auto-advances resolution. This function only returns actions during the
 * `'declaring'` mode for the player who currently has priority.
 */

import type { GameState, PlayerId, EvaluatedAction, PassChainPriorityAction } from '../../index.js';
import { logDetail } from './log.js';

/**
 * Returns the legal actions available to the given player while a chain
 * of effects is active. Only the priority player may act during the
 * declaring phase; during resolution the reducer auto-advances.
 */
export function chainActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const chain = state.chain!;

  // During resolution, the reducer auto-advances — no player input needed
  if (chain.mode === 'resolving') {
    logDetail(`Chain is resolving — no actions for player ${playerId as string}`);
    return [];
  }

  // Only the priority player may act
  if (playerId !== chain.priority) {
    logDetail(`Player ${playerId as string} does not have chain priority — no actions`);
    return [];
  }

  const actions: EvaluatedAction[] = [];

  // TODO Phase 4+: compute playable response cards from hand based on
  // chain restriction and what can legally be played in response

  // The priority player can always pass
  const passAction: PassChainPriorityAction = {
    type: 'pass-chain-priority',
    player: playerId,
  };
  actions.push({ action: passAction, viable: true });

  logDetail(`Chain declaring: player ${playerId as string} has ${actions.length} action(s) (pass${actions.length > 1 ? ' + responses' : ' only'})`);

  return actions;
}
