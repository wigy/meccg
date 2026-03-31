/**
 * @module rule-5.13-mh-step5-draw-cards
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.13: Step 5: Draw Cards
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement/Hazard Phase, Step 5 (Draw Cards) - If the company is moving, both players simultaneously draw cards based on the new site if moving to one of the resource player's non-haven sites OR based on the site of origin if moving to one of the resource player's haven sites:
 * • The resource player may draw up to the number in the lighter box in the bottom-left of the site card, so long as the moving company contains an avatar or a character with mind three or greater. If the company does, the resource player must draw at least one card (unless an effect would reduce the number drawn to less than one).
 * • The hazard player may draw up to the number in the darker box in the bottom-left of the site card, and must draw at least one card (unless an effect would reduce the number drawn to less than one).
 * No other actions can be taken during this step, which happens immediately and is considered synonymous with revealing the site.
 */

import { describe, test } from 'vitest';

describe('Rule 5.13 — Step 5: Draw Cards', () => {
  test.todo('If moving, both players draw cards based on site card; resource player needs avatar or mind>=3 character');
});
