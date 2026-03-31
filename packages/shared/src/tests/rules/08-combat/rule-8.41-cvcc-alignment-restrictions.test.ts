/**
 * @module rule-8.41-cvcc-alignment-restrictions
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.41: CvCC Alignment Restrictions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A Wizard player's company can only attack a Ringwraith player's company, a Fallen-wizard player's overt company, or a Balrog player's company.
 * [MINION] A Ringwraith player's company can only attack a Wizard player's company or a Fallen-Wizard player's company.
 * [FALLEN-WIZARD] A Fallen-wizard player's covert company can only attack a Ringwraith player's company or a Balrog player's company.
 * [FALLEN-WIZARD] A Fallen-wizard player's overt company may attack any company, and may be attacked by any company.
 * [BALROG] A Balrog player's company can only attack a Wizard player's company or a Fallen-Wizard player's company.
 */

import { describe, test } from 'vitest';

describe('Rule 8.41 — CvCC Alignment Restrictions', () => {
  test.todo('Each alignment can only attack certain other alignments');
});
