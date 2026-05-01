/**
 * @module rule-8.11-combat-step4-strike-sequences
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.11: Step 4: Strike Sequences
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Combat, Step 4 (Strike Sequences) - Once strikes are assigned, in an order determined by the defending player, a "strike sequence" is performed for each assigned strike, which is the time from when the defending player declares that a character will resolve a strike until the strike roll(s) and any associated body checks are made. Each strike sequence proceeds through the following Steps 1-6 (3.v.1-6) immediately in order, during which the designated actions, and only those actions, may be taken; however, strike sequences don't follow immediately one after the other, meaning that players may also take actions before, between, and/or after strike sequences if the action would otherwise be legal during the current phase of the game in which combat is taking place.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  ORC_PATROL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  dispatch, resolveChain,
  makeWildernessMHState,
  handCardId, companyIdAt, findCharInstanceId,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../../test-helpers.js';
import { Phase } from '../../../index.js';
import type { AssignStrikeAction, ChooseStrikeOrderAction } from '../../../index.js';

describe('Rule 8.11 — Step 4: Strike Sequences', () => {
  beforeEach(() => resetMint());

  test('After all strikes assigned, defending player chooses strike resolution order', () => {
    // ORC_PATROL (3 strikes) vs ARAGORN + LEGOLAS + GIMLI. All 3 assigned
    // (1 each). Phase becomes 'choose-strike-order'. Defender picks LEGOLAS
    // first. Combat enters resolve for LEGOLAS. After resolving, defender
    // picks again.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const gameState = { ...state, phaseState: makeWildernessMHState() };

    const orcId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);

    const afterChain = resolveChain(dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    }));

    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);

    // Defender assigns 1 strike to each character
    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId, tapped: false });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId, tapped: false });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId, tapped: false });

    // All 3 strikes assigned — phase should move to choose-strike-order
    expect(s.combat!.phase).toBe('choose-strike-order');

    // Defender has choose-strike-order actions for each assigned character
    const chooseActions = viableActions(s, PLAYER_1, 'choose-strike-order');
    expect(chooseActions.length).toBe(3);

    const charIds = chooseActions.map(ea => (ea.action as ChooseStrikeOrderAction).characterId);
    expect(charIds).toEqual(expect.arrayContaining([aragornId, legolasId, gimliId]));

    // Defender picks LEGOLAS first
    const pickLegolas = chooseActions.find(
      ea => (ea.action as ChooseStrikeOrderAction).characterId === legolasId,
    );
    expect(pickLegolas).toBeDefined();
    s = dispatch(s, pickLegolas!.action);

    // Combat enters resolve-strike for LEGOLAS
    expect(s.combat!.phase).toBe('resolve-strike');
    const currentAssignment = s.combat!.strikeAssignments[s.combat!.currentStrikeIndex];
    expect(currentAssignment.characterId).toBe(legolasId);

    // Resolve LEGOLAS's strike (roll high to succeed)
    const resolveActions = viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    s = dispatch({ ...s, cheatRollTotal: 12 }, resolveActions[0].action);

    // After resolving, defender chooses the next strike order
    expect(s.combat!.phase).toBe('choose-strike-order');
    const remainingChoices = viableActions(s, PLAYER_1, 'choose-strike-order');
    expect(remainingChoices.length).toBe(2);
  });

  test('Actions are allowed between strike sequences', () => {
    // ORC_PATROL (3 strikes) vs ARAGORN + LEGOLAS + GIMLI. All 3 assigned.
    // After ARAGORN's strike resolves, 2 remain — engine enters choose-strike-order
    // again (the "between sequences" window). Defender picks again from 2 choices.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const gameState = { ...state, phaseState: makeWildernessMHState() };

    const orcId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);

    const afterChain = resolveChain(dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    }));

    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);

    // All 3 strikes assigned, 1 per character
    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId, tapped: false });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId, tapped: false });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId, tapped: false });

    expect(s.combat!.phase).toBe('choose-strike-order');

    // Defender picks ARAGORN first
    const pickAragorn = viableActions(s, PLAYER_1, 'choose-strike-order').find(
      ea => (ea.action as ChooseStrikeOrderAction).characterId === aragornId,
    );
    expect(pickAragorn).toBeDefined();
    s = dispatch(s, pickAragorn!.action);
    s = dispatch({ ...s, cheatRollTotal: 12 }, viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike')[0].action);

    // After ARAGORN resolves, 2 unresolved remain — back to choose-strike-order
    expect(s.combat!.phase).toBe('choose-strike-order');
    const remainingChoices = viableActions(s, PLAYER_1, 'choose-strike-order');
    expect(remainingChoices).toHaveLength(2);
    const remainingIds = remainingChoices.map(ea => (ea.action as ChooseStrikeOrderAction).characterId);
    expect(remainingIds).toEqual(expect.arrayContaining([legolasId, gimliId]));
  });
});
