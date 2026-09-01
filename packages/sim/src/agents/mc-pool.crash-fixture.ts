/**
 * @module agents/mc-pool.crash-fixture
 *
 * Deliberately crashing worker entry, used only by mc-pool.test.ts to
 * simulate a dead worker without paying for the real mc-worker's card-pool
 * load. Throws unconditionally at module load, before ever registering a
 * `parentPort` message handler — the same "the worker never got a chance to
 * run its own try/catch" failure mode a genuinely broken worker start hits.
 */
throw new Error('mc-pool test fixture: deliberate startup crash');
