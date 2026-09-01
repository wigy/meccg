/**
 * @module agents/mc-pool
 *
 * Worker pool for the parallel flat Monte-Carlo agent
 * (specs/2026-07-28-parallel-monte-carlo.md §3). The agent seam is
 * synchronous (`Agent.chooseAction` returns a decision, not a promise), so
 * the pool blocks the calling thread with `Atomics.wait` on a shared
 * control word while workers fill a shared per-round result matrix —
 * results cross the boundary as raw Float64 cells, never as messages.
 *
 * One pool per agent instance, created lazily on the first searched
 * decision and reused for the whole game: worker startup (module load +
 * card pool) costs far more than a round. Workers are `unref()`ed so an
 * idle pool never keeps the process alive.
 *
 * The tally matrix is round-major and the caller accumulates it in
 * ascending (round, candidate) order — the exact iteration order of the
 * serial loop — so for a fixed round count the parallel agent's sums are
 * bit-identical to the serial agent's, non-associative float addition and
 * all.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import type { GameAction, PlayerId, PlayerView } from '@meccg/shared';
import type { McDecisionMessage } from './mc-worker.js';

/** One searched decision's inputs. */
export interface McPoolDecision {
  readonly view: PlayerView;
  readonly actions: readonly GameAction[];
  readonly baseSeed: number;
  /** Upper bound on rounds; every round below it runs unless stopped. */
  readonly roundCap: number;
  readonly horizonTurns: number;
  readonly maxDecisions: number;
  readonly unknownSites: 'sample' | 'inert' | undefined;
  readonly playerIds: readonly [PlayerId, PlayerId];
  readonly searcher: PlayerId;
  /** Wall-clock budget; undefined = run every round (reproducible mode). */
  readonly timeMs: number | undefined;
}

/**
 * Resolves the worker entry: the sibling `.ts` under tsx/vitest — the
 * worker registers tsx's CommonJS require hook, matching how the parent
 * tsx process loads these modules (`--import tsx` resolves the
 * `.js`-suffixed TS-source imports as ESM and fails) — or the compiled
 * `.js` sibling when running from `dist`.
 */
function workerEntry(): { readonly file: string; readonly execArgv: string[] } {
  const tsEntry = path.join(__dirname, 'mc-worker.ts');
  if (fs.existsSync(tsEntry)) return { file: tsEntry, execArgv: ['--require', 'tsx/cjs'] };
  return { file: path.join(__dirname, 'mc-worker.js'), execArgv: [] };
}

/**
 * Zero-progress watchdog: with the calling thread blocked in
 * `Atomics.wait`, worker `error` events cannot be delivered, so a worker
 * that dies (or never finishes starting) would otherwise hang the game
 * silently — the failure mode this converts into a loud throw. A round is
 * milliseconds of work and worker startup a few seconds, so two minutes
 * without the done-counter moving means something is dead.
 */
const NO_PROGRESS_TIMEOUT_MS = 120_000;

/** Blocking worker pool for Monte-Carlo rounds. */
export class McPool {
  private workers: Worker[] = [];
  private readonly jobs: number;
  private readonly noProgressTimeoutMs: number;
  private readonly entryOverride?: { readonly file: string; readonly execArgv: string[] };

  /**
   * @param noProgressTimeoutMs Watchdog override, test-only — production
   *   code always gets the {@link NO_PROGRESS_TIMEOUT_MS} default; a real
   *   two-minute wait is not something a test should sit through.
   * @param entryOverride Worker script override, test-only — lets a test
   *   point the pool at a worker that deliberately dies on startup instead
   *   of paying for the real mc-worker's card-pool load.
   */
  constructor(
    jobs: number,
    noProgressTimeoutMs: number = NO_PROGRESS_TIMEOUT_MS,
    entryOverride?: { readonly file: string; readonly execArgv: string[] },
  ) {
    this.jobs = Math.max(1, Math.floor(jobs));
    this.noProgressTimeoutMs = noProgressTimeoutMs;
    this.entryOverride = entryOverride;
  }

  /** Lazily spawns the workers (first searched decision pays the startup). */
  private ensureWorkers(): void {
    if (this.workers.length > 0) return;
    const entry = this.entryOverride ?? workerEntry();
    for (let workerIndex = 0; workerIndex < this.jobs; workerIndex++) {
      const worker = new Worker(entry.file, {
        execArgv: entry.execArgv,
        workerData: { workerIndex, workerCount: this.jobs },
      });
      worker.on('error', (err: Error) => {
        // A dead worker's done-counter bump is lost, so its round never
        // completes and the zero-progress watchdog below eventually throws
        // to surface the failure loudly — but that throw happens inside
        // `runRounds`, on the same call stack `chooseAction()` started, so
        // `safeChooseAction` (client-common.ts) can catch it and fall back
        // to a safe move. This callback runs later and separately: with the
        // caller blocked in `Atomics.wait`, the 'error' event cannot be
        // delivered until that blocking loop finally returns control to the
        // event loop, by which point the decision (and its try/catch) has
        // already completed. Throwing *here* would therefore be a genuinely
        // uncaught exception with nothing left on the stack to catch it,
        // killing the whole AI client outright — observed as the AI process
        // dying mid-game with no further moves ever offered (bug report:
        // game mtijwas7-dqm2i1, AI died right after the first searched
        // decision of the game, in the organization phase after untap).
        console.error(`mc-pool worker ${workerIndex} died: ${err.message}`);
      });
      worker.unref();
      this.workers.push(worker);
    }
  }

  /**
   * Runs one decision's rounds across the pool and returns the round-major
   * result matrix (`roundCap × actions.length`, NaN = no sample). Blocks
   * the calling thread; in time-budget mode the stop flag is raised at the
   * deadline and workers finish (at most) their current round.
   */
  runRounds(decision: McPoolDecision): Float64Array {
    this.ensureWorkers();
    const candidateCount = decision.actions.length;
    const resultsSab = new SharedArrayBuffer(decision.roundCap * candidateCount * 8);
    const results = new Float64Array(resultsSab);
    results.fill(Number.NaN);
    const controlSab = new SharedArrayBuffer(8);
    const control = new Int32Array(controlSab);

    const message: McDecisionMessage = {
      kind: 'decision',
      view: decision.view,
      actions: decision.actions,
      baseSeed: decision.baseSeed,
      roundCap: decision.roundCap,
      horizonTurns: decision.horizonTurns,
      maxDecisions: decision.maxDecisions,
      unknownSites: decision.unknownSites,
      playerIds: decision.playerIds,
      searcher: decision.searcher,
      results: resultsSab,
      control: controlSab,
    };
    const startedAt = Date.now();
    for (const worker of this.workers) worker.postMessage(message);

    const deadline = decision.timeMs === undefined ? undefined : startedAt + decision.timeMs;
    let lastProgressAt = Date.now();
    let lastDone = 0;
    for (;;) {
      const done = Atomics.load(control, 0);
      if (done >= this.jobs) break;
      if (done !== lastDone) {
        lastDone = done;
        lastProgressAt = Date.now();
      } else if (Date.now() - lastProgressAt > this.noProgressTimeoutMs) {
        throw new Error(`mc-pool: no worker progress for ${this.noProgressTimeoutMs} ms (${done}/${this.jobs} done) — a worker died or never started`);
      }
      if (deadline === undefined) {
        Atomics.wait(control, 0, done, this.noProgressTimeoutMs);
        continue;
      }
      const left = deadline - Date.now();
      if (left > 0) {
        Atomics.wait(control, 0, done, left);
      } else {
        // Deadline passed: raise the stop flag, then keep waiting — workers
        // stop between rounds, so this wait is bounded by one round.
        Atomics.store(control, 1, 1);
        Atomics.wait(control, 0, done, 50);
      }
    }
    return results;
  }

  /** Terminates the workers (tests; production pools die with the process). */
  async close(): Promise<void> {
    await Promise.all(this.workers.map(worker => worker.terminate()));
    this.workers = [];
  }
}
