/**
 * @module 10-events.test
 *
 * Tests for CoE Rules Section 5: Events (Short, Long, Permanent).
 *
 * Rule references from docs/coe-rules.md.
 */

import { describe, test } from 'vitest';

describe('5 Short-events', () => {
  test.todo('[5] short-event effects immediately implemented then discarded');
  test.todo('[5] short-events may be played during any phase unless restricted');
});

describe('5 Long-events', () => {
  test.todo('[5] long-events remain in play for one complete turn cycle');
  test.todo('[5] resource long-events discarded at beginning of long-event phase');
  test.todo('[5] hazard long-events discarded at end of long-event phase');
  test.todo('[5] long-events may be played regardless of immediate effect');
  test.todo('[5] resource long-events only during long-event phase');
  test.todo('[5] hazard long-events only during opponent movement/hazard phase');
});

describe('5 Permanent-events', () => {
  test.todo('[5] permanent-events remain in play until discarded by effects');
  test.todo('[5] permanent-events on a company: discarded if all characters leave');
});
