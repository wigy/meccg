/**
 * @module rule-5.30-multiple-movements
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.30: Multiple Movements Per Turn
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a company moves multiple times in one turn, each movement/hazard phase begins immediately after the previous phase concludes, and resources played during the organization phase that depend on the site or site path of a moving company are reapplied at the beginning of each movement/hazard phase if their conditions are met.
 */

import { describe, test } from 'vitest';

describe('Rule 5.30 — Multiple Movements Per Turn', () => {
  // No card or effect grants a company a second movement within the same
  // turn (only `extra-region-distance`, which extends a single declared
  // path, exists — grepped for "second-movement"/"extra-movement"/
  // "move-again"/"additional-movement", no matches). `company.moved` is set
  // once per company per turn and only reset at the start of the next turn,
  // so a company's M/H phase cannot currently re-trigger within one turn to
  // exercise this rule.
  test.todo('If company moves multiple times, each M/H phase begins immediately after previous; org phase resources reapplied');
});
