/**
 * @module rule-3.44-region-movement
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.44: Region Movement
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * REGION MOVEMENT - To use Region Movement, the company's new site must be located within four consecutive regions (or a maximum of six consecutive regions if using an effect that allows movement through more than four regions) from the company's current site, without repeating regions and including both the region of the current site and of the new site.
 * [HERO] A Wizard player's company that is using Region Movement to or from sites in Gorgoroth cannot move through Imlad Morgul without starting or stopping there.
 * [MINION] A Ringwraith player's companies may move as if Dagorlad and Ûdun are adjacent.
 * [FALLEN-WIZARD] A Fallen-wizard player's company that is using Region Movement to or from sites in Gorgoroth cannot move through Imlad Morgul without starting or stopping there.
 * [BALROG] A Balrog player's companies may move as if Dagorlad and Ûdun are adjacent.
 */

import { describe, test } from 'vitest';

describe('Rule 3.44 — Region Movement', () => {
  test.todo('Region movement: new site within 4 consecutive regions (or 6 with effect), no repeating');
});
