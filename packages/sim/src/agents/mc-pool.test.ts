/**
 * @module agents/mc-pool.test
 *
 * Regression test for the AI crash reported in game mtijwas7-dqm2i1: the
 * human's opponent (AI-MC) died right after the game's first searched
 * decision (organization phase, immediately after untap) and never made
 * another move. Root cause: `runRounds` blocks the calling thread on
 * `Atomics.wait`, so a dead worker's `error` event can only be delivered
 * once that blocking loop returns control to the event loop — by then,
 * `chooseAction`'s call stack (and `safeChooseAction`'s try/catch in
 * client-common.ts) has already finished. A handler that itself throws is
 * therefore a genuinely uncaught exception with nothing left to catch it,
 * killing the whole AI client. The fix logs instead of throwing and relies
 * on the zero-progress watchdog inside `runRounds` — still on the
 * synchronous, catchable call stack — to surface the failure.
 */

import { describe, test, expect } from 'vitest';
import * as path from 'path';
import { McPool } from './mc-pool.js';
import type { McPoolDecision } from './mc-pool.js';
import type { PlayerId } from '@meccg/shared';

/** Worker entry that crashes on startup, standing in for a dead worker. */
const CRASH_FIXTURE = {
  file: path.join(__dirname, 'mc-pool.crash-fixture.ts'),
  execArgv: ['--require', 'tsx/cjs'],
};

const EMPTY_DECISION: McPoolDecision = {
  view: {} as McPoolDecision['view'],
  actions: [],
  baseSeed: 1,
  roundCap: 1,
  horizonTurns: 1,
  maxDecisions: 1,
  unknownSites: undefined,
  playerIds: ['p1', 'p2'] as [PlayerId, PlayerId],
  searcher: 'p1' as PlayerId,
  timeMs: undefined,
};

describe('McPool worker crash handling', () => {
  test('a dead worker surfaces as a synchronous, catchable error instead of crashing the process', () => {
    // A short watchdog keeps the test fast; production uses the real
    // two-minute NO_PROGRESS_TIMEOUT_MS default.
    const pool = new McPool(1, 200, CRASH_FIXTURE);
    expect(() => pool.runRounds(EMPTY_DECISION)).toThrow(/no worker progress/);
  });
});
