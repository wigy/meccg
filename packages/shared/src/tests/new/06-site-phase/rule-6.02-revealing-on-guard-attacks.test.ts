/**
 * @module rule-6.02-revealing-on-guard-attacks
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.02: Step 1: Revealing On-Guard Attacks
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Entering a Site, Step 1 (Revealing On-Guard Attacks) - If the site has one or more automatic-attacks when the company enters, the hazard player may reveal and play on-guard cards placed on the site if either of the following criteria is met:
 * • The on-guard card is a creature that may be keyed to the site (in which case, it attacks after the automatic-attacks).
 * • The on-guard card is a hazard event that would affect the automatic-attack(s) of the site.
 * Other on-guard events may also be revealed when the company attempts to play a resource that taps the site (as described later in the site phase rules). No other actions can be taken during this step, which happens immediately.
 * Adding an additional automatic-attack or removing an existing automatic-attack counts as affecting a site's automatic-attack(s) for the purpose of revealing an on-guard event.
 */

import { describe, test } from 'vitest';

describe('Rule 6.02 — Step 1: Revealing On-Guard Attacks', () => {
  test.todo('If site has automatic-attacks, hazard player may reveal on-guard creatures keyed to site or events affecting auto-attacks');
});
