/**
 * @module rule-3.12-character-influence-control
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.12: Character Influence Control
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Whenever a non-avatar character is played, it must be played under general influence or direct influence according to the following restrictions:
 * • To be played under general influence, the character must be played either into a preexisting company or its own new company (but regardless of whether doing so would exceed its player's maximum general influence).
 * • To be played under direct influence, the character must be played into a preexisting company as a follower of a character that is currently being controlled with general influence, and the played character's mind cannot exceed the available direct influence of the other character.
 * The cumulative mind of a player's non-avatar, non-follower characters is subtracted from that player's general influence, while the cumulative mind of a character's followers is subtracted from the direct influence of the controlling character.
 */

import { describe, test } from 'vitest';

describe('Rule 3.12 — Character Influence Control', () => {
  test.todo('Characters played under general or direct influence; follower mind subtracted from controlling character DI');
});
