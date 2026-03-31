/**
 * @module rule-5.20-creature-keying-equivalence
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.20: Creature Keying Equivalence
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A creature "played on" a site is the same as being "keyed to" the site. A creature "played at a site in" a region is the same as being "keyed to" the site by name.
 * Attacks or strikes keyed to a region's/site's name are not affected by effects that only refer to attacks keyed to a region's/site's type, and vice versa.
 */

import { describe, test } from 'vitest';

describe('Rule 5.20 — Creature Keying Equivalence', () => {
  test.todo('Keyed to site = played on site; keyed to site in region = played at site in region; name vs type keying are separate');
});
