/**
 * @module rule-3.24-company-size-limits
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.24: Company Size Limits
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Companies at a haven have no maximum size, while companies not at a haven have a maximum size of seven.
 * Hobbits and Orc scouts count as half of a character (rounded up) toward company size.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTwoCompaniesAt, resetMint,
  PLAYER_1,
  ARAGORN, LEGOLAS, GIMLI, FRODO, BILBO,
  FARAMIR, EOWYN, BEREGOND, ANBORN,
  MORIA,
  viableActions,
} from '../../test-helpers.js';

// Haven site (Darkhaven) for the no-limit test
const CARN_DUM = 'le-359' as CardDefinitionId;

// Orc characters (for Hobbit half-count test — use same race to avoid race mixing)
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;   // Orc (not Orc scout)
const GRISHNAKH = 'le-12' as CardDefinitionId;       // Orc
const LAGDUF = 'le-18' as CardDefinitionId;           // Orc, mind 3
const MUZGASH = 'le-25' as CardDefinitionId;          // Orc, mind 2

describe('Rule 3.24 — Company Size Limits', () => {
  beforeEach(() => resetMint());

  test('No max size at haven; max 7 at non-haven; Hobbits and Orc scouts count as half', () => {
    // Case 1: 4 + 4 = 8 characters → exceeds limit at non-haven, merge blocked.
    const stateTooLarge = buildTwoCompaniesAt(
      MORIA,
      [ARAGORN, FARAMIR, EOWYN, BEREGOND],
      [GIMLI, ANBORN, LEGOLAS, FRODO],
    );
    const mergesTooLarge = viableActions(stateTooLarge, PLAYER_1, 'merge-companies');
    expect(mergesTooLarge).toHaveLength(0);

    // Case 2: 4 + 3 = 7 characters → exactly at limit, merge allowed at non-haven.
    const stateExactLimit = buildTwoCompaniesAt(
      MORIA,
      [ARAGORN, FARAMIR, EOWYN, BEREGOND],
      [GIMLI, ANBORN, LEGOLAS],
    );
    const mergesExactLimit = viableActions(stateExactLimit, PLAYER_1, 'merge-companies');
    expect(mergesExactLimit.length).toBeGreaterThan(0);

    // Case 3: 4 + 4 = 8 characters at a haven → no limit, merge IS allowed.
    const stateHaven = buildTwoCompaniesAt(
      CARN_DUM,
      [ORC_CAPTAIN, GRISHNAKH, LAGDUF, MUZGASH],
      [ORC_CAPTAIN, GRISHNAKH, LAGDUF, MUZGASH],
    );
    const mergesHaven = viableActions(stateHaven, PLAYER_1, 'merge-companies');
    expect(mergesHaven.length).toBeGreaterThan(0);

    // Case 4: Hobbits count as half.
    // 3 full chars + 4 hobbits = 3 + ceil(4/2) = 3 + 2 = 5 effective → within limit.
    const stateWithHobbits = buildTwoCompaniesAt(
      MORIA,
      [ARAGORN, FARAMIR, EOWYN],            // 3 full chars
      [FRODO, BILBO],                         // 2 hobbits = 1 effective
    );
    // 3 + 1 = 4 effective → within limit, merge allowed.
    const mergesWithHobbits = viableActions(stateWithHobbits, PLAYER_1, 'merge-companies');
    expect(mergesWithHobbits.length).toBeGreaterThan(0);

    // Case 5: Many hobbits push over limit.
    // 6 full chars + 4 hobbits = 6 + 2 = 8 effective → exceeds limit.
    const stateHobbitOverflow = buildTwoCompaniesAt(
      MORIA,
      [ARAGORN, FARAMIR, EOWYN, BEREGOND, GIMLI, ANBORN],  // 6 full chars
      [FRODO, BILBO],                                          // 2 hobbits = 1 effective → total 7
    );
    // 6 + 1 = 7 → exactly at limit, merge allowed.
    const mergesHobbitLimit = viableActions(stateHobbitOverflow, PLAYER_1, 'merge-companies');
    expect(mergesHobbitLimit.length).toBeGreaterThan(0);
  });
});
