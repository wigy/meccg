/**
 * @module rule-6.01-site-phase-order
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.01: Site Phase Order
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * In whatever order the resource player chooses, they must initiate a site phase for each of their companies, with each individual phase immediately following in the chosen order. The resource player cannot take actions during a company's site phase (unless the action is explicitly allowed during combat or by some other effect) until they choose for the company to either:
 * • do nothing, in which case that company's site phase ends immediately, or
 * • enter the company's current site and then potentially take further actions at the site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, makeSitePhase, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, BILBO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { SelectCompanyAction } from '../../../types/actions-movement-hazard.js';

describe('Rule 6.01 — Site Phase Order', () => {
  beforeEach(() => resetMint());

  test('Resource player initiates site phase for each company in chosen order; must enter or do nothing', () => {
    // Two companies: one at Rivendell, one at Moria
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
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
      phaseState: makeSitePhase({ step: 'select-company', handledCompanyIds: [] }),
    };

    // Both companies offered at select-company step
    const actions = viableFor(stateAtSelect, PLAYER_1)
      .filter(a => a.action.type === 'select-company') as { action: SelectCompanyAction }[];
    const companies = state.players[RESOURCE_PLAYER].companies;
    expect(actions).toHaveLength(2);
    expect(actions.some(a => a.action.companyId === companies[0].id)).toBe(true);
    expect(actions.some(a => a.action.companyId === companies[1].id)).toBe(true);

    // After the first company is handled, only the second is offered
    const stateFirstHandled = {
      ...stateAtSelect,
      phaseState: makeSitePhase({ step: 'select-company', handledCompanyIds: [companies[0].id] }),
    };
    const remaining = viableFor(stateFirstHandled, PLAYER_1)
      .filter(a => a.action.type === 'select-company') as { action: SelectCompanyAction }[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].action.companyId).toBe(companies[1].id);

    // Hazard player has no select-company actions during site phase
    const hazardActions = viableFor(stateAtSelect, PLAYER_2)
      .filter(a => a.action.type === 'select-company');
    expect(hazardActions).toHaveLength(0);
  });
});
