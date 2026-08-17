/**
 * @module rule-3.26-leader-restriction
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.26: Leader Restriction
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A company can only contain one leader unless at a haven.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, resetMint,
  PLAYER_1, PLAYER_2,
  ARAGORN,
  MORIA, MINAS_TIRITH, RIVENDELL, LORIEN,
  Alignment,
  viableActions,
} from '../../test-helpers.js';
import type { GameState } from '../../../index.js';
import type { PlanMovementAction } from '../../../types/actions-organization.js';

// Minion characters with Leader keyword
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;   // Orc, Leader, mind 5
const GORBAG = 'le-11' as CardDefinitionId;          // Orc, Leader, mind 6
const TROLL_CHIEF = 'le-45' as CardDefinitionId;     // Troll, Leader, Olog-hai
// Minion Orc character WITHOUT Leader keyword (for "one leader allowed" test)
const GRISHNAKH = 'le-12' as CardDefinitionId;       // Orc, no Leader keyword, mind 4

// Minion sites
const CARN_DUM = 'le-359' as CardDefinitionId;       // haven (Darkhaven)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // haven (Darkhaven)
const BARAD_DUR = 'le-352' as CardDefinitionId;      // dark-hold (not a haven); nearestHaven Minas Morgul

/** Build two companies at the same site, each with one Leader character. */
function buildTwoLeaderCompanies(site: CardDefinitionId): GameState {
  const built = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [
          { site, characters: [ORC_CAPTAIN] },
          { site, characters: [GORBAG] },
        ],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
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
    ],
  };
}

describe('Rule 3.26 — Leader Restriction', () => {
  beforeEach(() => resetMint());

  test('Company can only contain one leader unless at a haven', () => {
    // At a non-haven site, merging two companies each with a Leader is blocked.
    const stateNonHaven = buildTwoLeaderCompanies(MORIA);

    const mergesAtNonHaven = viableActions(stateNonHaven, PLAYER_1, 'merge-companies');
    expect(mergesAtNonHaven).toHaveLength(0);

    // At a haven (Darkhaven), two Leaders CAN coexist — merge is offered.
    const stateHaven = buildTwoLeaderCompanies(CARN_DUM);

    const mergesAtHaven = viableActions(stateHaven, PLAYER_1, 'merge-companies');
    expect(mergesAtHaven.length).toBeGreaterThan(0);

    // Merging two companies where only one has a Leader is allowed at non-haven.
    // Both are Orcs to avoid triggering the race-mixing restriction (rule 3.25).
    const stateOneLeader = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ORC_CAPTAIN] },
            { site: MORIA, characters: [GRISHNAKH] },  // Orc, but no Leader keyword
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const sharedMoria = stateOneLeader.players[0].companies[0].currentSite!;
    const stateOneLeaderShared: GameState = {
      ...stateOneLeader,
      players: [
        {
          ...stateOneLeader.players[0],
          companies: stateOneLeader.players[0].companies.map((c, i) =>
            i === 1 ? { ...c, currentSite: sharedMoria, siteCardOwned: false } : c,
          ),
        },
        stateOneLeader.players[1],
      ] as unknown as typeof stateOneLeader.players,
    };

    const mergesOneLeader = viableActions(stateOneLeaderShared, PLAYER_1, 'merge-companies');
    expect(mergesOneLeader.length).toBeGreaterThan(0);
  });

  test('The leader restriction also applies to moving companies: a company with two leaders cannot declare movement away from a haven', () => {
    // A company with two Leaders (Orc Captain + Troll-chief), formed at Minas
    // Morgul (a Darkhaven — legal per the haven exemption), must not be
    // offered Barad-dûr (a dark-hold, not a haven) as a movement destination:
    // per the glossary "leader" definition, the one-leader-per-company limit
    // "also applies to moving companies", so the two-leader company can only
    // move to another haven.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN, TROLL_CHIEF] }],
          hand: [],
          siteDeck: [BARAD_DUR],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const baradDurInst = state.players[0].siteDeck.find(s => s.definitionId === BARAD_DUR)!.instanceId;
    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    expect(plans.every(ea => (ea.action as PlanMovementAction).destinationSite !== baradDurInst)).toBe(true);

    // Control: a company with only one Leader (Orc Captain alone) at the same
    // site CAN declare movement to Barad-dûr — confirming the site is normally
    // reachable and the exclusion above is specifically the leader restriction.
    const stateOneLeader = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }],
          hand: [],
          siteDeck: [BARAD_DUR],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const baradDurInstOneLeader = stateOneLeader.players[0].siteDeck.find(s => s.definitionId === BARAD_DUR)!.instanceId;
    const plansOneLeader = viableActions(stateOneLeader, PLAYER_1, 'plan-movement');
    expect(plansOneLeader.some(ea => (ea.action as PlanMovementAction).destinationSite === baradDurInstOneLeader)).toBe(true);
  });
});
