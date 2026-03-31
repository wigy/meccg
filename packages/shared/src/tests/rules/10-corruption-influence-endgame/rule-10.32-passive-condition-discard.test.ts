/**
 * @module rule-10.32-passive-condition-discard
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.32: Passive Condition Discard
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a passive condition would result in a card being discarded, the passive condition resolves immediately instead of in a subsequent chain of effects.
 * If a passive condition would be inititated due to a card being discarded but another copy of the discarded card is in play, the passive condition is not initiated.
 */

import { describe, test } from 'vitest';

describe('Rule 10.32 — Passive Condition Discard', () => {
  test.todo('Passive condition resulting in discard resolves immediately; not initiated if another copy of discarded card in play');
});
