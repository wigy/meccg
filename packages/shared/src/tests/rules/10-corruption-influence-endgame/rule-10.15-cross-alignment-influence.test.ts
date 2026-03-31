/**
 * @module rule-10.15-cross-alignment-influence
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.15: Cross-Alignment Influence Penalty
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] If a Wizard player's character (not an agent hazard) makes an influence attempt against a Ringwraith player's card or a Balrog player's card, the Wizard player's roll is modified by -5.
 * [MINION] If a Ringwraith player's character (not an agent hazard) makes an influence attempt against a Wizard player's card or a Fallen-wizard player's card, the Ringwraith player's roll is modified by -5.
 * [FALLEN-WIZARD] If a Fallen-wizard player's character (not an agent hazard) makes an influence attempt against a Ringwraith player's card or a Balrog player's card, the Fallen-wizard player's roll is modified by -5.
 * [BALROG] If a Balrog player's character (not an agent hazard) makes an influence attempt against a Wizard player's card or Fallen-wizard player's card, the Balrog player's roll is modified by -5.
 */

import { describe, test } from 'vitest';

describe('Rule 10.15 — Cross-Alignment Influence Penalty', () => {
  test.todo('Each alignment gets -5 when influencing certain opponent alignments');
});
