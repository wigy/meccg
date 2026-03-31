/**
 * @module rule-10.01-corruption-check
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.01: Corruption Check
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * To resolve a corruption check on a character, the character's player makes a roll and applies any modifications. The result of the modified roll is compared to the character's "corruption point total," meaning the sum of corruption points on the cards that the character controls:
 * • If the modified roll is greater than the character's corruption point total, the corruption check succeeds and there is no other effect.
 * • If the modified roll is equal to or one less than the character's corruption point total, the effect depends on the character's alignment. A hero character fails the check and is immediately discarded along with all of its non-follower cards; a Wizard avatar fails the check and is immediately eliminated along with all of its non-follower cards; and a minion character or Fallen-wizard avatar taps and the corruption check is considered successful.
 * • If the modified roll is less than two or lower than the character's corruption point total, the character fails the corruption check, it is immediately eliminated, and all of its non-follower cards are immediately discarded.
 */

import { describe, test } from 'vitest';

describe('Rule 10.01 — Corruption Check', () => {
  test.todo('Roll vs corruption point total: greater = success; equal or -1 = depends on alignment; less than by 2+ = eliminated');
});
