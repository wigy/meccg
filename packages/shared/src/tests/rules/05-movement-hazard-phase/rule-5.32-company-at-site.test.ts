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
  // non-site state rule 5.32 describes.
  //
  // Checked for a concrete violation: `fireHavenRestoreTriggers`
  // (mh-hazard-play.ts) offers Hall of Fire's (dm-134) untap/heal benefit by
  // checking `company.currentSite.siteType === 'haven'` right when the
  // company's own M/H sub-phase ends — squarely inside rule 5.32's
  // transitional window. But this is not actually a violation: Hall of
  // Fire's own printed text is "any company at this Haven *immediately
  // following its movement/hazard phase*" — an explicit, card-specific
  // trigger point independent of the general "at" predicate. No other code
  // queries "is a DIFFERENT company at site X" during another company's M/H
  // sub-phase (the only place the discrepancy could be observed), so there
  // is no reachable scenario to assert on without first modeling the
  // transitional state itself — a broad change (new state field, plus an
  // audit of every `currentSite` read across org/M/H/site phases to decide
  // which should see the "official" vs. "physical" site) disproportionate
  // to this one clause.
  test.todo('Company is "at" its site at all times except from reveal until prior to site phases after end of all M/H phases');
});
