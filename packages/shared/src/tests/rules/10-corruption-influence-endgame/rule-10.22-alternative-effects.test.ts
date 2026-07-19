/**
 * @module rule-10.22-alternative-effects
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.22: Alternative Effect Active Conditions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a card specifies that it has an "alternative" effect without listing any "playable" active conditions for that effect, the "playable" active conditions from the primary effect of the card still apply. The following cards are exceptions to this rule: Gloom, Good Sense Revolts, Half an Eye Open, Heedless Revelry, Here is a Snake, In the Name of Mordor, Inner Cunning, Nobody's Friend, Withdrawn to Mordor, and Wolf-riders.
 */

import { describe, test } from 'vitest';

// This is a card-certification rule about how a specific card's DSL should
// be authored (an alternative `play-option` without its own `when`/target
// gating inherits the primary effect's play-condition), not a generic
// engine behavior with its own code path to test in isolation — whichever
// certified card exercises this is proven by that card's own test, not by a
// standalone rule test. None of the ten named exception cards (Gloom, Good
// Sense Revolts, Half an Eye Open, Heedless Revelry, Here is a Snake, In the
// Name of Mordor, Inner Cunning, Nobody's Friend, Withdrawn to Mordor,
// Wolf-riders) is yet certified in this pool, so there is also no
// concrete exception case to contrast against.
describe('Rule 10.22 — Alternative Effect Active Conditions', () => {
  test.todo('If card has alternative effect without own playable conditions, primary conditions still apply (with listed exceptions)');
});
