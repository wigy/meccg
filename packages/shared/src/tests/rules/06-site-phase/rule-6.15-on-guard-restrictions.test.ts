/**
 * @module rule-6.15-on-guard-restrictions
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.15: On-Guard Reveal Restrictions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A hazard cannot be revealed in this way if it meets any of the following criteria:
 * a) Returns the company to its site of origin
 * b) Taps the company's site
 * c) Potentially removes a character from the company, unless via combat or corruption checks (but a card that potentially removes an ally may be revealed)
 * d) Forces the company to do nothing during its site phase
 * e) Directly taps a character in the company.
 */

import { describe, test } from 'vitest';

describe('Rule 6.15 — On-Guard Reveal Restrictions', () => {
  test.todo('On-guard cannot: return to origin, tap site, remove character (except via combat/CC), force do-nothing, or directly tap character');
});
