import type { RngState } from './types/state.js';

export function createRng(seed: number): RngState {
  return { seed, counter: 0 };
}

/**
 * Returns [value between 0 and 1, next RNG state].
 * Uses a simple mulberry32-based PRNG for deterministic results.
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
 * Returns a random integer in [0, max), plus the next RNG state.
 */
export function nextInt(state: RngState, max: number): [number, RngState] {
  const [value, next] = nextRng(state);
  return [Math.floor(value * max), next];
}

/**
 * Fisher-Yates shuffle. Returns [shuffled copy, next RNG state].
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
