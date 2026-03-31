/**
 * @module rule-2.07-company-loses-all-characters
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.07: Company Loses All Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If all characters in a company leave play, all permanent-events played on the company as a whole are immediately discarded. If the company's player has no other companies at the same site, the site must be immediately returned to its player's location deck if it is untapped, discarded if it is tapped, or stay in play until the end of all movement/hazard phases for the turn if this occurs during the company's movement/hazard phase (at which point the normal rules for sites at the end of the movement/hazard phase are followed).
 */

import { describe, test } from 'vitest';

describe('Rule 2.07 — Company Loses All Characters', () => {
  test.todo('All characters leave play: company permanent-events are discarded');

  test.todo('No other company at same site and site untapped: site returned to location deck');

  test.todo('No other company at same site and site tapped: site discarded');

  test.todo('During movement/hazard phase: site stays until end of all M/H phases');

  test.todo('Another company at same site: site remains in play');
});
