/**
 * @module 12-corruption.test
 *
 * Tests for CoE Rules Section 7: Corruption.
 *
 * Rule references from docs/coe-rules.txt lines 585-603.
 */

import { describe, test } from 'vitest';

describe('7 Corruption checks', () => {
  test.todo('[7] corruption check: roll 2d6 + modifiers vs corruption point total');
  test.todo('[7] roll > CP: check succeeds, no effect');
  test.todo('[7] roll = CP or CP-1: hero character discarded with non-follower cards');
  test.todo('[7] roll = CP or CP-1: wizard avatar eliminated with non-follower cards');
  test.todo('[7] roll = CP or CP-1: minion character taps, check considered successful');
  test.todo('[7] roll <= CP-2: character eliminated, non-follower cards discarded');
  test.todo('[7] tap characters in same company for +1 modifier each to corruption check');
  test.todo('[7] required corruption check must be made even with zero CP');
  test.todo('[7] allies, ringwraiths, and balrogs not affected by corruption');
});

describe('7 Corruption cards', () => {
  test.todo('[7] corruption card: hazard with corruption keyword');
  test.todo('[7] only one corruption card may be played on each character per turn');
  test.todo('[7] corruption card can only be played when initiating new chain of effects');
  test.todo('[7] corruption cards cannot be played on dwarves also cannot be played on orcs');
  test.todo('[7] removing corruption card: tap character and roll, or -3 to stay untapped');
});
