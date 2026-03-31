/**
 * @module rule-8.22-creature-mp-by-alignment
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.22: Creature MP by Player Alignment
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] When a Wizard player defeats a creature with a "*" next to its marshalling points, the creature is removed from play instead of being placed in the player's marshalling point pile.
 * [MINION] When a Ringwraith player defeats a creature without a "*" next to its marshalling points, the creature is removed from play instead of being placed in the player's marshalling point pile.
 * [FALLEN-WIZARD] When a Fallen-wizard player defeats a creature with a "*" next to its marshalling points, the creature is removed from play instead of being placed in the player's marshalling point pile.
 * [BALROG] When a Balrog player defeats a creature without a "*" next to its marshalling points, the creature is removed from play instead of being placed in the player's marshalling point pile.
 */

import { describe, test } from 'vitest';

describe('Rule 8.22 — Creature MP by Player Alignment', () => {
  test.todo('Hero/FW: creatures with * removed from play instead of MP pile; Minion/Balrog: creatures without * removed');
});
