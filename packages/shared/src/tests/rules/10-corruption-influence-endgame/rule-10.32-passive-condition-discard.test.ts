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

// A refinement of rule 10.31's general "passive condition opens a new chain"
// rule, carving out discard-triggered passives as an immediate exception.
// The chain-reducer's passive-detection pass has no distinct "immediate vs.
// next-chain" branch keyed on whether the triggered effect is a discard —
// all detected passives currently queue the same way. The "duplicate copy
// in play suppresses the passive" clause likewise has no matching check
// (nothing in the discard-effect path counts other copies of the discarded
// card before queueing a triggered effect). No certified card's discard
// passive has been played alongside a duplicate copy to expose either gap.
describe('Rule 10.32 — Passive Condition Discard', () => {
  test.todo('Passive condition resulting in discard resolves immediately; not initiated if another copy of discarded card in play');
});
