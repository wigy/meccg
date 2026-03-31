/**
 * @module rule-5.06-mh-step2-site-path
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.06: Step 2: Determine the Site Path
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement/Hazard Phase, Step 2 (Determine the Site Path) - If the company is moving, the site from which the company is departing becomes its "site of origin." The resource player declares which type of movement is being used in order to determine the company's "site path":
 * • Starter Movement - The company's site path is the sequence of regions designated on the haven card(s) if moving from haven to haven, and otherwise is listed on the left side of the non-haven card. This site path includes the region types listed, as well as the name of the region containing the site of origin and the name of the region containing the new site (but no region names for any intervening regions).
 * • Region Movement - The company's site path is declared by the resource player when the new site is revealed. This declared sequence of regions may be different than the site's site path, but must have been legal when movement was initially declared during the organization phase (including not exceeding the maximum number of regions, not repeating regions, etc.). This site path includes both the region types and names of all regions being moved through.
 * • Under-Deeps Movement - The company doesn't have a site path (i.e. a surface site's region is not moved through).
 * • Special Movement - The company's site path depends on the effect being used for movement, but generally does not include regions unless the effect states otherwise.
 */

import { describe, test } from 'vitest';

describe('Rule 5.06 — Step 2: Determine the Site Path', () => {
  test.todo('Resource player declares movement type to determine site path; different rules per movement type');
});
