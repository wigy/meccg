/**
 * @module agents/mc-worker
 *
 * Worker-thread entry for the parallel flat Monte-Carlo agent
 * (specs/2026-07-28-parallel-monte-carlo.md). Each worker owns its own
 * card pool (loaded once at startup — never sent over the boundary) and
 * runs whole rounds: round *r* of a decision belongs to worker
 * `r % workerCount`, deterministically, so a round's common-random-numbers
 * pairing is never split and the assignment does not depend on scheduling.
 *
 * Per decision the main thread broadcasts the projected view, the
 * shortlisted candidates, and two SharedArrayBuffers: a per-round ×
 * per-candidate Float64 result matrix (NaN = no sample) and an Int32
 * control array ([0] done-worker counter, [1] stop flag). The worker
 * writes each completed round's TSD values into its own cells — single
 * writer per cell, and the main thread only reads after the done counter
 * says every worker finished, so the Atomics establish the necessary
 * happens-before. Between rounds it checks the stop flag (time-budget
 * mode), guaranteeing round granularity: a round is either fully in the
 * matrix or entirely absent.
 */

import { parentPort, workerData } from 'worker_threads';
import { reduce, loadCardPool, setEngineConsoleLog } from '@meccg/shared';
import type { GameAction, PlayerId, PlayerView } from '@meccg/shared';
import { determinizeNull } from '../search/determinize-null.js';
import { rollout } from '../search/rollout.js';
import { createRandomStream } from '../random-stream.js';

/** Broadcast sent by the pool once per searched decision. */
export interface McDecisionMessage {
  readonly kind: 'decision';
  readonly view: PlayerView;
  readonly actions: readonly GameAction[];
  readonly baseSeed: number;
  readonly roundCap: number;
  readonly horizonTurns: number;
  readonly maxDecisions: number;
  readonly unknownSites: 'sample' | 'inert' | undefined;
  readonly playerIds: readonly [PlayerId, PlayerId];
  readonly searcher: PlayerId;
  /** rounds × actions Float64 matrix, NaN-initialized. */
  readonly results: SharedArrayBuffer;
  /** [0] = done-worker counter, [1] = stop flag. */
  readonly control: SharedArrayBuffer;
}

const { workerIndex, workerCount } = workerData as { workerIndex: number; workerCount: number };

// 24 workers narrating rollouts would out-cost the search.
setEngineConsoleLog(false);
const cardPool = loadCardPool();

parentPort?.on('message', (message: McDecisionMessage) => {
  if (message.kind !== 'decision') return;
  const results = new Float64Array(message.results);
  const control = new Int32Array(message.control);
  const candidateCount = message.actions.length;

  try {
    for (let round = workerIndex; round < message.roundCap; round += workerCount) {
      // Time-budget mode: stop only between rounds, never inside one —
      // partial rounds would break the paired candidate comparison.
      if (Atomics.load(control, 1) === 1) break;

      try {
        // Identical seed derivation to the serial loop in mc-agent.ts —
        // this is what makes jobs=N bit-identical to jobs=1 at fixed
        // rollouts.
        const roundSeed = (message.baseSeed + round * 0x9e3779b9) | 0;
        const world = determinizeNull({
          view: message.view,
          seed: roundSeed,
          cardPool,
          unknownSites: message.unknownSites,
        });

        for (let i = 0; i < candidateCount; i++) {
          const applied = reduce(world.state, message.actions[i]);
          if (applied.error) continue;
          const result = rollout(applied.state, {
            playerIds: message.playerIds,
            searcher: message.searcher,
            unknownInstances: world.unknownInstances,
            horizonTurns: message.horizonTurns,
            maxDecisions: message.maxDecisions,
            random: createRandomStream(roundSeed ^ 0x2545f491),
          });
          results[round * candidateCount + i] = result.tsd;
        }
      } catch (err) {
        // A failed round loses its samples (cells stay NaN), matching the
        // serial agent's per-candidate resilience; the search continues.
        console.error(`mc-worker ${workerIndex}: round ${round} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    Atomics.add(control, 0, 1);
    Atomics.notify(control, 0);
  }
});
