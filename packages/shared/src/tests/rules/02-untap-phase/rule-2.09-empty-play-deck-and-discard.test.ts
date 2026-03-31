/**
 * @module rule-2.09-empty-play-deck-and-discard
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.09: Empty Play Deck and Discard
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a player ever has no cards in both their play deck and discard pile, the next card that the player discards immediately becomes their play deck.
 */

import { describe, test } from 'vitest';

describe('Rule 2.09 — Empty Play Deck and Discard', () => {
  test.todo('Both play deck and discard pile empty: next discarded card immediately becomes play deck');

  test.todo('Rule does not trigger if play deck is empty but discard has cards');

  test.todo('Rule does not trigger if discard is empty but play deck has cards');
});
