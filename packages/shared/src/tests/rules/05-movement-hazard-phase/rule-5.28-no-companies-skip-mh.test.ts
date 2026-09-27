/**
 * @module rule-5.28-no-companies-skip-mh
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.28: No Companies Skip M/H Phase
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If the resource player has no companies, that player skips their movement/hazard phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LEGOLAS, ARAGORN, GIMLI, FARAMIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  companyIdAt, findCharInstanceId,
  makeShadowMHState, enqueueCorruptionCheck,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';

describe('Rule 5.28 — No Companies Skip M/H Phase', () => {
  beforeEach(() => resetMint());

  test('If resource player has no companies, skip movement/hazard phase', () => {
    // P1 (active player) has no companies. When the long-event phase ends
    // and would normally transition to M/H phase, P1's M/H phase (and site
    // phase) must be skipped entirely, advancing directly to End-of-Turn.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [], hand: [], siteDeck: [RIVENDELL, MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const after = dispatch(base, { type: 'pass', player: PLAYER_1 });

    // M/H phase (and Site phase) must be skipped — should land in End-of-Turn
    expect(after.phaseState.phase).toBe(Phase.EndOfTurn);
  });

  test('The last company dissolving at select-company leaves the phase a way out', () => {
    // The entry check in the first test only sees the company count at the
    // long-event → M/H transition. P1's only character can still fail a
    // corruption check *after* that, while the phase sits at select-company —
    // and then there is no company to select, no company mid-flight to
    // finalize, and (P2 being the hazard player with nothing to answer) no
    // viable action for either player. Rule 2.IV.1 says a player with no
    // companies skips the phase, so a pass must be offered and accepted.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [], siteDeck: [] },
      ],
    });

    const legolasId = findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS);
    const readyState = enqueueCorruptionCheck(
      { ...base, phaseState: { ...makeShadowMHState(), step: 'select-company' as const } },
      PLAYER_1,
      legolasId,
    );

    // Roll 2 vs CP 10 → hard fail → Legolas eliminated → P1's only company
    // dissolves while the phase is still at select-company.
    const afterElimination = dispatch({ ...readyState, cheatRollTotal: 2 }, {
      type: 'corruption-check',
      player: PLAYER_1,
      characterId: legolasId,
      corruptionPoints: 10,
      corruptionModifier: 0,
      possessions: [],
      need: 11,
      explanation: 'Test',
    });
    expect(afterElimination.players[RESOURCE_PLAYER].companies).toEqual([]);
    expect(afterElimination.phaseState.phase).toBe(Phase.MovementHazard);

    // Neither player can select, play, or answer anything — the pass is the
    // only thing standing between this state and a deadlocked game.
    const legalActions = computeLegalActions(afterElimination, PLAYER_1);
    expect(legalActions.some(a => a.action.type === 'pass' && a.viable)).toBe(true);

    // Rule 2.IV.1 skips the M/H phase, and rule 2.V.7 the site phase after it.
    const afterPass = dispatch(afterElimination, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.phaseState.phase).toBe(Phase.EndOfTurn);
  });

  test('A company dissolving mid-M/H-phase does not cause a later company to skip its own M/H phase', () => {
    // P1 has three companies. The middle one (Aragorn, alone) is mid-way
    // through its own M/H phase when a hazard-driven corruption check (e.g.
    // Alone and Unadvised) eliminates him, dissolving that company and
    // shifting the third company (Gimli) down one slot in the companies
    // array. Every company must still get its own M/H phase (CoE 2.IV) —
    // Gimli's company must not be silently skipped because it now sits at
    // the index the dissolved company used to occupy.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [LEGOLAS] },
            { site: MORIA, characters: [ARAGORN] },
            { site: MINAS_TIRITH, characters: [GIMLI] },
          ],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [], siteDeck: [] },
      ],
    });

    const company0Id = companyIdAt(base, RESOURCE_PLAYER, 0);
    const company2Id = companyIdAt(base, RESOURCE_PLAYER, 2);
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    // Company 0 already handled; company 1 (Aragorn) is the active company.
    const mhState = {
      ...makeShadowMHState(),
      step: 'play-hazards' as const,
      activeCompanyIndex: 1,
      handledCompanyIds: [company0Id],
    };
    const readyState = enqueueCorruptionCheck(
      { ...base, phaseState: mhState },
      PLAYER_1,
      aragornId,
    );

    // Roll 2 vs CP 10 → two or more below CP → hard fail, Aragorn eliminated
    // regardless of alignment (classifyCorruptionOutcome).
    const afterElimination = dispatch({ ...readyState, cheatRollTotal: 2 }, {
      type: 'corruption-check',
      player: PLAYER_1,
      characterId: aragornId,
      corruptionPoints: 10,
      corruptionModifier: 0,
      possessions: [],
      need: 11,
      explanation: 'Test',
    });

    // Aragorn eliminated → company1 dissolved immediately (unlike combat
    // deaths, a corruption-check death cleans up the companies array right
    // away) → company2 (Gimli) shifts down into company1's old array slot.
    expect(afterElimination.players[RESOURCE_PLAYER].companies.map(c => c.id)).toEqual([company0Id, company2Id]);

    // Finish company1's now-dissolved M/H slot.
    const afterPass1 = dispatch(afterElimination, { type: 'pass', player: PLAYER_1 });
    const afterPass2 = dispatch(afterPass1, { type: 'pass', player: PLAYER_2 });

    // Must return to select-company for the still-unhandled Gimli company,
    // not skip straight past the M/H phase. The dissolved company1 is never
    // added to handledCompanyIds (it no longer exists to attribute an id
    // to) — the remaining-company count is instead derived from the
    // (already-shrunk) companies array, which correctly still shows one
    // unhandled company (Gimli's).
    expect(afterPass2.phaseState.phase).toBe(Phase.MovementHazard);
    if (afterPass2.phaseState.phase === Phase.MovementHazard) {
      expect(afterPass2.phaseState.step).toBe('select-company');
      expect(afterPass2.phaseState.handledCompanyIds).toEqual([company0Id]);
    }

    const legalActions = computeLegalActions(afterPass2, PLAYER_1);
    expect(legalActions.some(a =>
      a.action.type === 'select-company' && a.action.companyId === company2Id,
    )).toBe(true);
  });

  test('A handled company that dissolves later does not end the M/H phase before the last company moves', () => {
    // Regression from random self-play (sim seed 95000, decks m vs p): the
    // first company finished its M/H phase and was recorded in
    // handledCompanyIds, then dissolved (all characters eliminated). Its
    // stale id kept `companies.length - handledCompanyIds.length` one too
    // low, so the phase ended after the second-to-last company — the last
    // company never moved, was auto-merged into a company at its origin,
    // and its drawn destination site vanished from the game.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [LEGOLAS] },
            { site: MORIA, characters: [ARAGORN] },
            { site: MINAS_TIRITH, characters: [GIMLI] },
          ],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [], siteDeck: [] },
      ],
    });

    const company0Id = companyIdAt(base, RESOURCE_PLAYER, 0);
    const company1Id = companyIdAt(base, RESOURCE_PLAYER, 1);
    const company2Id = companyIdAt(base, RESOURCE_PLAYER, 2);
    const legolasId = findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS);

    // Company 0 was handled, then dissolved: it is gone from the companies
    // array but its id is still in handledCompanyIds. Company 1 (Aragorn,
    // now at index 0) is mid-way through its own M/H phase.
    const p1 = base.players[RESOURCE_PLAYER];
    const remainingCharacters = { ...p1.characters };
    delete remainingCharacters[legolasId];
    const dissolved = {
      ...base,
      players: [
        { ...p1, companies: p1.companies.slice(1), characters: remainingCharacters },
        base.players[1],
      ] as const,
      phaseState: {
        ...makeShadowMHState(),
        step: 'play-hazards' as const,
        activeCompanyIndex: 0,
        handledCompanyIds: [company0Id],
      },
    };

    const afterPass1 = dispatch(dissolved, { type: 'pass', player: PLAYER_1 });
    const afterPass2 = dispatch(afterPass1, { type: 'pass', player: PLAYER_2 });

    // Gimli's company is still unhandled: back to select-company, not Site.
    expect(afterPass2.phaseState.phase).toBe(Phase.MovementHazard);
    if (afterPass2.phaseState.phase === Phase.MovementHazard) {
      expect(afterPass2.phaseState.step).toBe('select-company');
      expect(afterPass2.phaseState.handledCompanyIds).toEqual([company0Id, company1Id]);
    }
    const legalActions = computeLegalActions(afterPass2, PLAYER_1);
    expect(legalActions.some(a =>
      a.action.type === 'select-company' && a.action.companyId === company2Id,
    )).toBe(true);
  });
});
