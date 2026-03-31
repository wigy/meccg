/**
 * @module rule-6.05-cancel-auto-attack
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.05: Canceling Automatic-Attacks
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A character at one of its home sites may be tapped to cancel an automatic-attack at that site if the home site is named (i.e. not "any Dark-Hold").
 * Removing an automatic-attack from a site is not the same as canceling the actual attack, and thus cannot be done by the resource player during a site phase prior to entering the site.
 */

import { describe, test } from 'vitest';

describe('Rule 6.05 — Canceling Automatic-Attacks', () => {
  test.todo('Character at named home site may tap to cancel auto-attack; removing auto-attack is not canceling');
});
