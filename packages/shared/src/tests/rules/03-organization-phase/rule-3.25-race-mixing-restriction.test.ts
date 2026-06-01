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
import { Phase } from '../../../index.js';
import type { CardDefinitionId, GameState } from '../../../index.js';
import {
  buildTestState, resetMint,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FRODO, BILBO,
  MORIA, MINAS_TIRITH, RIVENDELL, LORIEN,
  viableActions,
} from '../../test-helpers.js';

// Minion Orc character (for race mixing tests)
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;   // Orc
const GRISHNAKH = 'le-12' as CardDefinitionId;       // Orc, mind 4

// Minion haven (Darkhaven)
const CARN_DUM = 'le-359' as CardDefinitionId;

/** Build two companies sharing the same site. */
function buildTwoCompaniesAt(
  site: CardDefinitionId,
  company1Chars: CardDefinitionId[],
  company2Chars: CardDefinitionId[],
): GameState {
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [
          { site, characters: company1Chars },
          { site, characters: company2Chars },
        ],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });

  // Share the same site instance between both companies
  const sharedSite = built.players[0].companies[0].currentSite!;
  return {
    ...built,
    players: [
      {
        ...built.players[0],
        companies: built.players[0].companies.map((c, i) =>
          i === 1 ? { ...c, currentSite: sharedSite, siteCardOwned: false } : c,
        ),
      },
      built.players[1],
    ] as unknown as typeof built.players,
  };
}

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
