/**
 * @module rng
 *
 * Seeded pseudo-random number generator built on the Mulberry32 algorithm.
 *
 * Every RNG operation is pure — it accepts an {@link RngState} and returns
 * both the result and the *next* state, so callers thread the state through
 * the game pipeline without mutation. This makes game replays fully
 * deterministic: given the same seed, every shuffle, dice roll, and random
 * draw will produce identical results regardless of platform or timing.
 */

import type { RngState } from './types/state.js';

/**
 * Creates a fresh RNG state from a numeric seed.
 *
 * @param seed - An integer seed (e.g. `Date.now()` or a fixed value for tests).
 * @returns An initial {@link RngState} with counter set to 0.
 */
export function createRng(seed: number): RngState {
  return { seed, counter: 0 };
}

/**
 * Produces a floating-point value in [0, 1) and the next RNG state.
 *
 * Uses the Mulberry32 algorithm — a fast 32-bit PRNG with good statistical
 * properties. The state is never mutated; a new state object is returned.
 *
 * @param state - The current RNG state.
 * @returns A tuple of `[value, nextState]` where `value` is in [0, 1).
 */
export function nextRng(state: RngState): [number, RngState] {
  const next = { seed: state.seed, counter: state.counter + 1 };
  // mulberry32
  let t = (state.seed + state.counter * 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/**
 * Returns a random integer in [0, max) plus the next RNG state.
 *
 * Thin wrapper around {@link nextRng} that scales and floors the result.
 *
 * @param state - The current RNG state.
 * @param max - The exclusive upper bound (must be a positive integer).
 * @returns A tuple of `[integer, nextState]`.
 */
export function nextInt(state: RngState, max: number): [number, RngState] {
  const [value, next] = nextRng(state);
  return [Math.floor(value * max), next];
}

/**
 * Produces a uniformly-random permutation of `array` using the
 * Fisher-Yates (Knuth) shuffle algorithm.
 *
 * The original array is not mutated. This is the primary shuffling
 * primitive used for deck creation and any randomised ordering.
 *
 * @typeParam T - Element type of the array.
 * @param array - The source array (not mutated).
 * @param state - The current RNG state.
 * @returns A tuple of `[shuffledCopy, nextState]`.
 */
export function shuffle<T>(array: readonly T[], state: RngState): [T[], RngState] {
  const result = [...array];
  let rng = state;
  for (let i = result.length - 1; i > 0; i--) {
    let j: number;
    [j, rng] = nextInt(rng, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return [result, rng];
}
