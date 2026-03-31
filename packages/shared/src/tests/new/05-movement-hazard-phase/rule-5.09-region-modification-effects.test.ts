/**
 * @module rule-5.09-region-modification-effects
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.09: Region Modification Effects
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a named region has its type modified or otherwise treated differently by an effect, that modification is immediately reflected in all site paths (both for site cards and moving companies) where that region is also specified by name. If an unnamed region has its type directly modified or otherwise treated differently by an effect, that modification is only reflected in the site path where the unnamed region was changed. In other words, if an effect modifies an unnamed region in a site's path or a corresponding company's site path to/from the site while using Starter Movement, that modification is immediately reflected in that same site path and any other company's site paths using Starter Movement to/from that site, but nowhere else.
 */

import { describe, test } from 'vitest';

describe('Rule 5.09 — Region Modification Effects', () => {
  test.todo('Named region type modifications reflected in all site paths where named; unnamed only where changed');
});
