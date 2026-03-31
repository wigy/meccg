/**
 * @module rule-8.39-cvcc-strike-sequence
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.39: CvCC Strike Sequence
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * CvCC Strike Sequence Steps:
 * Step 1 - Attacking player may play resources/take actions affecting strike resolution.
 * Step 2 - Attacking player allocates excess strikes as -1 prowess.
 * Step 3 - Attacking player may apply -3 to stay untapped.
 * Step 4 - Defending player may apply -3 to stay untapped.
 * Step 5 - Defending player may tap untapped characters for +1 support.
 * Step 6 - Defending player may play resources/take actions affecting strike.
 * Step 7 - Both players roll and add modified prowess; weapon mods first; tapped -1, wounded -2.
 * Step 8 - Compare rolls: higher wins (loser is wounded + body check), tie = both tapped.
 */

import { describe, test } from 'vitest';

describe('Rule 8.39 — CvCC Strike Sequence', () => {
  test.todo('CvCC strike sequence: both players roll and compare; loser wounded + body check; includes -3 to stay untapped and +1 support');
});
