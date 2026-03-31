/**
 * @module rule-8.32-detainment-attacks
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.32: Detainment Attacks
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If an attack is detainment, no body checks are initiated at the end of its strike sequences, meaning that if the character's modified roll is greater than the strike's prowess, the strike fails without a body check, and if the character's modified roll is less than the strike's prowess, the character is tapped instead of being wounded.
 * If a strike from a detainment attack is successful, the defending character is not considered to have been wounded and passive conditions that depend on a character being wounded are not initiated.
 * Whether a creature's attack is detainment depends on the type of player whose company is being attacked (or depends on an effect of the attack itself).
 */

import { describe, test } from 'vitest';

describe('Rule 8.32 — Detainment Attacks', () => {
  test.todo('Detainment: no body checks; successful strike taps instead of wounds; not considered wounded');
});
