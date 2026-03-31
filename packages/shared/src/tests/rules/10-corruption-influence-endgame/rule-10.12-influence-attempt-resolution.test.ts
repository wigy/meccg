/**
 * @module rule-10.12-influence-attempt-resolution
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.12: Resolving an Influence Attempt
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Resolving an Influence Attempt - To resolve an influence attempt against an opponent's card, the resource player follows these steps:
 * 1) Roll 2D6.
 * 2) Add the influencing character's unused direct influence.
 * 3) Subtract the hazard player's unused general influence.
 * 4) Subtract the result of a 2D6 rolled by the hazard player.
 * 5) If the card being influenced is controlled by a character, subtract the unused direct influence of the character controlling the card.
 * 6) Apply any other modifications.
 * This modified result is then compared to a second value depending on the type of card being influenced (i.e. the modified roll must normally be higher than the following number), except that this second value is treated as zero if an identical non-item card was revealed prior to the roll:
 * • Allies - The mind value of the target ally
 * • Characters - The mind value of the target character being influenced
 * • Factions - The value required for the influence check on the faction that is already in play
 * • Items - The mind value of the character controlling the target item
 * If the resource player's final modified roll is greater than this second value, the influence check is successful and the card being influenced is immediately discarded along with any non-follower cards that it controlled; otherwise the influence check fails.
 */

import { describe, test } from 'vitest';

describe('Rule 10.12 — Resolving an Influence Attempt', () => {
  test.todo('Roll 2D6 + unused DI - opponent GI - opponent roll - controlling character DI + mods; compare to target mind/influence value');
});
