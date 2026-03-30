/**
 * @module 13-influence.test
 *
 * Tests for CoE Rules Section 8: Influence Attempts.
 *
 * Rule references from docs/coe-rules.md.
 */

import { describe, test } from 'vitest';

describe('8 Influence attempt preconditions', () => {
  test.todo('[8] influence attempt: tap character during site phase');
  test.todo('[8] not allowed on first turn');
  test.todo('[8] company must have entered site this turn');
  test.todo('[8] cannot attempt if already attempted or attacked this turn');
  test.todo('[8] cannot influence avatar or card controlled by avatar');
  test.todo('[8] avatar making attempt cannot have been played this turn');
});

describe('8 Influence attempt resolution', () => {
  test.todo('[8] roll 2d6 + unused DI - opponent unused GI - opponent 2d6');
  test.todo('[8] subtract controlling character unused DI if applicable');
  test.todo('[8] ally: compare to mind value of target ally');
  test.todo('[8] character: compare to mind value of target character');
  test.todo('[8] faction: compare to faction influence check value');
  test.todo('[8] item: compare to mind of controlling character');
  test.todo('[8] revealing identical card: second value treated as zero');
  test.todo('[8] successful: target discarded with non-follower cards');
  test.todo('[8] successful + revealed identical: may play the identical card immediately');
  test.todo('[8] failed + revealed identical: identical card discarded');
  test.todo('[HERO] wizard vs ringwraith/balrog card: -5 modifier');
});
