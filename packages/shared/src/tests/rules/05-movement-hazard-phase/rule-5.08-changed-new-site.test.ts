/**
 * @module rule-5.08-changed-new-site
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.08: Changed New Site
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If an effect changes a moving company's new site, the new site's site path changes accordingly but the company's site path does not change.
 */

import { describe, test } from 'vitest';

describe('Rule 5.08 — Changed New Site', () => {
  // No effect type that redirects a moving company to a different
  // destination site exists anywhere in the DSL or card pool (grepped for
  // "redirect"/"change-destination"/"new-destination" — no matches). Without
  // such an effect there is no "changed new site" scenario to distinguish
  // the site card's own path from the company's site path against.
  test.todo('If effect changes new site, site path on card changes but company site path does not');
});
