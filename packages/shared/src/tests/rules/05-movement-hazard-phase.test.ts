/**
 * @module 05-movement-hazard-phase.test
 *
 * Tests for CoE Rules Section 2.IV: Movement/Hazard Phase.
 *
 * Rule references from docs/coe-rules.md.
 */

import { describe, test } from 'vitest';

// ─── Steps 1-3: Reveal, Site Path, Hazard Limit ──────────────────────────────

describe('2.IV.i-iii Movement setup', () => {
  test.todo('[2.IV.i] reveal new site: if moving, new site is revealed; no actions');
  test.todo('[2.IV.i.1] under-deeps movement roll: stay if roll < site number');
  test.todo('[2.IV.i.2] illegal movement at reveal: movement negated, company stays');
  test.todo('[2.IV.ii] determine site path: origin becomes site of origin, declare movement type');
  test.todo('[2.IV.iii] base hazard limit = company size or 2, whichever greater');
  test.todo('[2.IV.iii] hazard limit halved if hazard player accessed sideboard this untap');
});

// ─── Steps 4-6: Ongoing Effects, Draw, Passive Conditions ────────────────────

describe('2.IV.iv-vi Movement preparations', () => {
  test.todo('[2.IV.iv] hazard player determines order of ongoing effects');
  test.todo('[2.IV.v] if moving: both players draw cards based on site');
  test.todo('[2.IV.v] resource player draws up to lighter box number');
  test.todo('[2.IV.v] hazard player draws up to darker box number, must draw at least 1');
  test.todo('[2.IV.vi] passive conditions resolved in resource player order');
});

// ─── Step 7: Play Hazards ────────────────────────────────────────────────────

describe('2.IV.vii Playing hazards', () => {
  test.todo('[2.IV.vii] hazard player may take actions until hazard limit reached');
  test.todo('[2.IV.vii.1] playing agent as hazard: face-down untapped, counts as 1 against limit');
  test.todo('[2.IV.vii.2] playing creature: must be keyed to company site path or new site');
  test.todo('[2.IV.vii.2.1] when creature resolves, attack immediately initiates combat');
  test.todo('[2.IV.vii.2.2] creature keyed to region/site name vs type distinction');
  test.todo('[2.IV.vii.3] playing hazard event: counts as 1 against limit');
  test.todo('[2.IV.vii.4] placing on-guard card: face-down on new site, once per phase');
  test.todo('[2.IV.vii.5] sideboarding with nazgul: tap/discard to access sideboard, counts as 1');
});

// ─── Step 8: End Company Movement/Hazard ─────────────────────────────────────

describe('2.IV.viii End of movement/hazard', () => {
  test.todo('[2.IV.viii] site of origin discarded if tapped/non-haven, returned if untapped/haven');
  test.todo('[2.IV.viii] both players reset hands to 8 cards');
  test.todo('[2.IV.1] skip movement/hazard phase if resource player has no companies');
  test.todo('[2.IV.4] company returned to origin: phase ends immediately');
  test.todo('[2.IV.6] must join companies at non-haven sites at end of movement/hazard');
  test.todo('[2.IV.6] may choose to join at haven sites');
});
