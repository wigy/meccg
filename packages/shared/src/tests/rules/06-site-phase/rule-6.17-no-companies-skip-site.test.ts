/**
 * @module rule-6.17-no-companies-skip-site
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.17: No Companies Skip Site Phase
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If the resource player has no companies, that player skips their site phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  makeMHState, companyIdAt,
} from '../../test-helpers.js';

describe('Rule 6.17 — No Companies Skip Site Phase', () => {
  beforeEach(() => resetMint());

  test('If resource player has no companies, skip site phase', () => {
    // When all of P1's companies finish their M/H phase and no companies
    // remain afterwards (e.g. all empty after cleanup), the site phase is
    // skipped and the game advances directly to End-of-Turn.
    //
    // We test the zero-company case by entering MH with no companies —
    // the engine skips both MH and Site, landing at End-of-Turn.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [], hand: [], siteDeck: [RIVENDELL, MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const after = dispatch(base, { type: 'pass', player: PLAYER_1 });

    // Site phase must be skipped — game lands in End-of-Turn, not Site
    expect(after.phaseState.phase).not.toBe(Phase.Site);
    expect(after.phaseState.phase).toBe(Phase.EndOfTurn);
  });

  test('Site phase entered normally when resource player has companies', () => {
    // Contrast: when P1 does have companies, the game advances to Site phase.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0, hazardLimitAtReveal: 2 });
    const stateAtMH = { ...base, phaseState: mhState };
    const companyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);

    // Both players pass → company's M/H phase ends → all companies handled → Site phase
    const afterP1Pass = dispatch(stateAtMH, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterP1Pass, { type: 'pass', player: PLAYER_2 });

    expect(afterBothPass.phaseState.phase).toBe(Phase.Site);
    void companyId;
  });
});
