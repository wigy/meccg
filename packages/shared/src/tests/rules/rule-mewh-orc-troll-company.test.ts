/**
 * MEWH §9 — Orc/Troll company composition.
 *
 * Source: The White Hand Insert, "Special Orc & Troll Rules": "Unless at a
 * Wizardhaven, an Orc or Troll cannot be in the same company as an Elf, Dwarf,
 * Dúnadan, or Hobbit."
 *
 * The base race-mixing restriction (CoE 3.25) already bars Orc/Troll from
 * sharing a company with Elf/Dwarf/Dúnadan/Hobbit at non-haven sites. MEWH
 * narrows the *haven exception* for a Fallen-wizard to his Wizardhavens only:
 * at a METW Haven (e.g. Rivendell) the restriction still applies, but at a
 * Wizardhaven (e.g. Isengard) the company may mix. Exercised via move-to-company.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';
import {
  buildTestState, resetMint, viableActions,
  PLAYER_1, PLAYER_2, LORIEN, MINAS_TIRITH,
  Phase,
} from '../test-helpers.js';

const RIVENDELL = 'tw-421' as CardDefinitionId; // METW Haven (not a Wizardhaven)
const ISENGARD = 'wh-56' as CardDefinitionId;   // Fallen-wizard Wizardhaven
const GORBAG = 'le-11' as CardDefinitionId;      // Orc
const ASTERNAK = 'le-1' as CardDefinitionId;     // Man (filler GI character)
const BILBO = 'tw-131' as CardDefinitionId;      // Hobbit

/**
 * Two Fallen-wizard companies sharing one site instance at `site`: [Orc, Man]
 * and [Hobbit]. The shared site instance is required for move-to-company, which
 * groups companies by site instance ID.
 */
function fwTwoCompanies(site: CardDefinitionId): GameState {
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [
          { site, characters: [GORBAG, ASTERNAK] },
          { site, characters: [BILBO] },
        ],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
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
    ],
  };
}

/** Whether the Orc can be moved into the Hobbit company. */
function orcCanJoinHobbitCompany(state: GameState): boolean {
  const moves = viableActions(state, PLAYER_1, 'move-to-company');
  const orcId = Object.values(state.players[0].characters)
    .find(c => c.definitionId === GORBAG)!.instanceId;
  return moves.some(a => (a.action as { characterInstanceId: string }).characterInstanceId === orcId);
}

describe('MEWH §9 — Orc/Troll company composition', () => {
  beforeEach(() => resetMint());

  test('an Orc may join a Hobbit company at a Wizardhaven', () => {
    expect(orcCanJoinHobbitCompany(fwTwoCompanies(ISENGARD))).toBe(true);
  });

  test('an Orc may NOT join a Hobbit company at a METW Haven (not a Wizardhaven)', () => {
    expect(orcCanJoinHobbitCompany(fwTwoCompanies(RIVENDELL))).toBe(false);
  });
});
