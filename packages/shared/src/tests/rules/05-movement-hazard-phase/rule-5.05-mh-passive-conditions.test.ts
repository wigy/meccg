/**
 * @module rule-5.05-mh-passive-conditions
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.05: Passive Conditions at M/H Phase Start
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Passive conditions that would be initiated at the beginning of a movement/hazard phase are initiated after after all steps that are synonymous with revealing the new site.
 */

import { describe, test } from 'vitest';

describe('Rule 5.05 — Passive Conditions at M/H Phase Start', () => {
  // The underlying claim — steps 1-4 (reveal site, determine site path,
  // under-deeps roll, set hazard limit / establish order) always complete
  // before anything else — is already exercised end-to-end by rule 5.03
  // ("Under-deeps roll success ... auto-advances through set-hazard-limit
  // to draw-cards") and rule 5.12 ("Step 4 happens immediately with no
  // player action"). No card in the current pool declares an on-event
  // trigger literally keyed to the beginning of the movement/hazard phase
  // (the closest, `company-arrives-at-site`, fires at the *end* of the
  // phase per rule 5.32/5.26 instead), so there is no additional,
  // non-redundant scenario to exercise for this rule specifically.
  test.todo('Passive conditions at beginning of M/H phase are initiated after all steps synonymous with revealing new site');
});
