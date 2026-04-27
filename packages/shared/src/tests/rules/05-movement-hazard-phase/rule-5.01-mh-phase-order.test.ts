/**
 * @module rule-5.01-mh-phase-order
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.01: Movement/Hazard Phase Order
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * In whatever order the resource player chooses, they must initiate a movement/hazard phase for each of their companies. Each individual phase immediately follows in the chosen order, and each proceeds through the following Steps 1-8 (2.IV.i-viii) regardless of whether the company is moving.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, makeMHState, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, BILBO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { SelectCompanyAction } from '../../../types/actions-movement-hazard.js';

describe('Rule 5.01 — Movement/Hazard Phase Order', () => {
  beforeEach(() => resetMint());

  test('Resource player initiates M/H phase for each company in chosen order; each proceeds through steps 1-8', () => {
    // Two companies: one at Rivendell with Aragorn, one at Moria with Bilbo
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] },
            { site: MORIA, characters: [BILBO] },
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const stateAtSelect = {
      ...state,
      phaseState: makeMHState({ step: 'select-company', handledCompanyIds: [] }),
    };

    // Both companies should be offered
    const actions = viableFor(stateAtSelect, PLAYER_1)
      .filter(a => a.action.type === 'select-company') as { action: SelectCompanyAction }[];
    const companies = state.players[RESOURCE_PLAYER].companies;
    expect(actions).toHaveLength(2);
    expect(actions.some(a => a.action.companyId === companies[0].id)).toBe(true);
    expect(actions.some(a => a.action.companyId === companies[1].id)).toBe(true);

    // After handling the first company, only the second is offered
    const stateFirstHandled = {
      ...stateAtSelect,
      phaseState: makeMHState({ step: 'select-company', handledCompanyIds: [companies[0].id] }),
    };
    const remaining = viableFor(stateFirstHandled, PLAYER_1)
      .filter(a => a.action.type === 'select-company') as { action: SelectCompanyAction }[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].action.companyId).toBe(companies[1].id);

    // Hazard player has no select-company actions
    const hazardActions = viableFor(stateAtSelect, PLAYER_2)
      .filter(a => a.action.type === 'select-company');
    expect(hazardActions).toHaveLength(0);
  });
});
