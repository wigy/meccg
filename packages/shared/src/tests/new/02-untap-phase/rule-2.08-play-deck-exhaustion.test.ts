/**
 * @module rule-2.08-play-deck-exhaustion
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.08: Play Deck Exhaustion
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A play deck is "exhausted" when the last card is drawn from it. When a player exhausts their play deck, immediately discard any cards in play that would be discarded when a play deck is exhausted. The exhausting player then returns any site cards from their discard pile to their location deck, then may exchange up to five cards between their discard pile and sideboard (regardless of the type of cards), and then shuffles their discard pile which becomes their play deck. A play deck being exhausted and re-shuffled happens immediately when the last card is drawn (e.g. it may happen in the middle of drawing additional cards, which then resumes once the play deck is reset), and cannot be responded to.
 */

import { describe, test } from 'vitest';

describe('Rule 2.08 — Play Deck Exhaustion', () => {
  test.todo('When play deck exhausted: discard exhaustion-triggered cards, return sites to location deck, exchange up to 5 with sideboard, shuffle discard to become new play deck');
});
