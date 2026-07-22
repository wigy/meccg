/**
 * @module random-stream
 *
 * Seeded uniform random streams for agents, built on the engine's
 * Mulberry32 PRNG. Each agent gets its own stream derived from the game
 * seed and its player index, so agent sampling never perturbs the engine's
 * RNG state and games are bit-reproducible from `(seed, decks, agents)`.
 */

import { createRng, nextRng } from '@meccg/shared';
import type { RngState } from '@meccg/shared';

/** Creates a `() => number` stream yielding uniform values in [0, 1). */
export function createRandomStream(seed: number): () => number {
  let rng: RngState = createRng(seed);
  return () => {
    const [value, next] = nextRng(rng);
    rng = next;
    return value;
  };
}

/**
 * Derives a per-agent stream seed from the game seed and player index.
 * The golden-ratio constant scatters consecutive game seeds so the two
 * agents' streams never collide with each other or with the engine RNG.
 */
export function agentStreamSeed(gameSeed: number, playerIndex: number): number {
  return (gameSeed + 0x9e3779b9 * (playerIndex + 1)) | 0;
}
