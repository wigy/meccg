/**
 * @module rule-3.25-race-mixing-restriction
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.25: Race Mixing Restriction
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Dúnedain, Dwarves, Elves, and/or Hobbits cannot be in a company with Orcs and/or Trolls, unless at a haven.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTwoCompaniesAt, resetMint,
  PLAYER_1,
  ARAGORN, LEGOLAS, GIMLI, FRODO, BILBO,
  MORIA,
  viableActions,
} from '../../test-helpers.js';

// Minion Orc character (for race mixing tests)
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;   // Orc
const GRISHNAKH = 'le-12' as CardDefinitionId;       // Orc, mind 4

// Minion haven (Darkhaven)
const CARN_DUM = 'le-359' as CardDefinitionId;

describe('Rule 3.25 — Race Mixing Restriction', () => {
  beforeEach(() => resetMint());

  test('Dúnedain/Dwarves/Elves/Hobbits cannot be with Orcs/Trolls unless at haven', () => {
    // At a non-haven: Dúnedain (Aragorn) + Orc (Grishnákh) cannot be in same company.
    const stateNonHaven = buildTwoCompaniesAt(MORIA, [ARAGORN], [GRISHNAKH]);
    const mergesNonHaven = viableActions(stateNonHaven, PLAYER_1, 'merge-companies');
    expect(mergesNonHaven).toHaveLength(0);

    // At a haven: race mixing IS allowed.
    const stateHaven = buildTwoCompaniesAt(CARN_DUM, [ARAGORN], [GRISHNAKH]);
    const mergesHaven = viableActions(stateHaven, PLAYER_1, 'merge-companies');
    expect(mergesHaven.length).toBeGreaterThan(0);

    // Same-race companies can always merge at non-haven.
    const stateSameRace = buildTwoCompaniesAt(MORIA, [ORC_CAPTAIN], [GRISHNAKH]);
    const mergesSameRace = viableActions(stateSameRace, PLAYER_1, 'merge-companies');
    expect(mergesSameRace.length).toBeGreaterThan(0);

    // Elf + Orc also blocked at non-haven.
    const stateElfOrc = buildTwoCompaniesAt(MORIA, [LEGOLAS], [GRISHNAKH]);
    const mergesElfOrc = viableActions(stateElfOrc, PLAYER_1, 'merge-companies');
    expect(mergesElfOrc).toHaveLength(0);

    // Dwarf + Orc blocked at non-haven.
    const stateDwarfOrc = buildTwoCompaniesAt(MORIA, [GIMLI], [GRISHNAKH]);
    const mergesDwarfOrc = viableActions(stateDwarfOrc, PLAYER_1, 'merge-companies');
    expect(mergesDwarfOrc).toHaveLength(0);

    // Hobbit + Orc blocked at non-haven.
    const stateHobbitOrc = buildTwoCompaniesAt(MORIA, [FRODO], [GRISHNAKH]);
    const mergesHobbitOrc = viableActions(stateHobbitOrc, PLAYER_1, 'merge-companies');
    expect(mergesHobbitOrc).toHaveLength(0);

    // Hero-only company can merge with another hero-only company.
    const stateHeroHero = buildTwoCompaniesAt(MORIA, [ARAGORN], [BILBO]);
    const mergesHeroHero = viableActions(stateHeroHero, PLAYER_1, 'merge-companies');
    expect(mergesHeroHero.length).toBeGreaterThan(0);
  });
});
