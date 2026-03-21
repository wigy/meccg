/**
 * @module 15-ending-game.test
 *
 * Tests for CoE Rules Section 10: Ending the Game.
 *
 * Rule references from docs/coe-rules.txt lines 690-726.
 */

import { describe, test } from 'vitest';

describe('10 Winning with The One Ring', () => {
  test.todo('[HERO] Cracks of Doom or Gollum\'s Fate: wizard player wins');
  test.todo('[MINION] company bearing One Ring at Barad-dur: ringwraith wins');
});

describe('10 Calling the game (Short game)', () => {
  test.todo('[10] short game: call if >= 25 MP and deck exhausted once, or deck exhausted twice');
  test.todo('[10] calling: opponent gets one last turn');
  test.todo('[10] automatic end: both decks exhausted twice, game ends after current turn');
});

describe('10 Deck exhaustion', () => {
  test.todo('[10] deck exhausted when last card drawn');
  test.todo('[10] on exhaust: discard cards that would be discarded, return sites to location deck');
  test.todo('[10] on exhaust: exchange up to 5 cards between discard and sideboard');
  test.todo('[10] on exhaust: shuffle discard pile becomes new play deck');
  test.todo('[10] deck exhaustion happens immediately, cannot be responded to');
});

describe('10 Free Council: determining the winner', () => {
  test.todo('[10.3.i] corruption checks for all non-ringwraith non-balrog characters');
  test.todo('[10.3.i] either player may take actions affecting corruption checks');
  test.todo('[10.3.ii] total MPs for each of 6 sources: character, ally, item, faction, kill, misc');
  test.todo('[10.3.iii] doubling rule: if opponent has 0 in character/ally/item/faction, double yours');
  test.todo('[10.3.iv] diversity rule: no source > 50% of total positive MPs');
  test.todo('[10.3.v] reveal duplicates: reduce opponent MP by 1 per matching unique card');
  test.todo('[10.3.vi] apply -5 misc MP penalty for eliminated avatar');
  test.todo('[10.3.vii] highest MP total wins; tie = tie');
  test.todo('[HERO] minion items worth half MP (rounded up) for wizard players');
});
