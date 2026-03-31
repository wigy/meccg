/**
 * @module rule-5.10-mh-step3-hazard-limit
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.10: Step 3: Set the Base Hazard Limit
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement/Hazard Phase, Step 3 (Set the Base Hazard Limit) - The company's base hazard limit is set to the current size of the company or two, whichever is greater (rounded up), then the base hazard limit is halved (rounded up) if the hazard player accessed the sideboard during this turn's untap phase. Actions cannot be taken during this step, which happens immediately and is considered synonymous with revealing the new site.
 */

import { describe, test } from 'vitest';

describe('Rule 5.10 — Step 3: Set the Base Hazard Limit', () => {
  test.todo('Hazard limit = max(company size, 2), halved if sideboard accessed; fixed for duration of M/H phase');
});
