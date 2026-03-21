/**
 * @module state-utils
 *
 * Lightweight utility functions for querying {@link GameState} properties
 * that are used across both server and client packages. Keeps repetitive
 * index look-ups in one place so callers stay concise and consistent.
 */

import type { GameState, PlayerId } from './types/index.js';

/**
 * Returns the tuple index (0 or 1) of the player with the given ID.
 *
 * Every {@link GameState} stores exactly two players in a fixed-size tuple.
 * This helper centralises the common `state.players[0].id === id ? 0 : 1`
 * look-up that appears throughout the engine and projection layers.
 */
export function getPlayerIndex(state: GameState, playerId: PlayerId): 0 | 1 {
  return state.players[0].id === playerId ? 0 : 1;
}
