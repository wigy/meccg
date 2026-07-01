/**
 * @module rule-5.32-company-at-site
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.32: Company "At" Its Site
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A company is considered to be "at" its site card at all times except from the moment when its new site card is revealed until immediately prior to the company's player's site phases after the end of all movement/hazard phases for the turn.
 */

import { describe, test } from 'vitest';

describe('Rule 5.32 — Company "At" Its Site', () => {
  // The engine has no separate "en route" / "not at a site" state: a moving
  // company's `currentSite` is reassigned to the new site as soon as ITS
  // OWN M/H sub-phase completes (mh-hazard-play.ts, "Step 8a: Complete
  // movement"), not deferred until every company's M/H phase for the turn
  // has finished — so during the window between one company finishing its
  // M/H phase and the last company finishing theirs, this company's state
  // already reads as "at" its new site rather than the transitional
  // non-site state rule 5.32 describes. No card or existing rule currently
  // depends on this precise distinction (queries always ask "where is this
  // company now" from that company's own perspective), so there is no
  // observable-behavior scenario to assert on without first modeling the
  // transitional state itself.
  test.todo('Company is "at" its site at all times except from reveal until prior to site phases after end of all M/H phases');
});
