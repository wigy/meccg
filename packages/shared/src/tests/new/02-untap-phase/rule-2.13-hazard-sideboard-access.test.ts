/**
 * @module rule-2.13-hazard-sideboard-access
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.13: Hazard Sideboard Access at Untap
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * At the end of the untap phase, if the resource player's avatar is in play (or the resource player is Sauron), the hazard player may either:
 * • bring up to five hazards from their sideboard to their discard pile.
 * • if the hazard player's play deck has at least five cards, bring one hazard from their sideboard directly into their play deck and then shuffle.
 * The types of the cards must be revealed to confirm that they are hazards, but the actual card names don't need to be revealed. This action can only be taken once per turn, and if the hazard player takes this action, the base hazard limit for each of the resource player's companies at the start of this turn's movement/hazard phase(s) is halved (rounded up).
 */

import { describe, test } from 'vitest';

describe('Rule 2.13 — Hazard Sideboard Access at Untap', () => {
  test.todo('If resource player avatar is in play, hazard player may access sideboard (5 to discard or 1 to deck); halves hazard limits');
});
