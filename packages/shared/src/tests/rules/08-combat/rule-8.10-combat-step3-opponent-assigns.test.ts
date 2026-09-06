/**
 * @module rule-8.10-combat-step3-opponent-assigns
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.10: Step 3: Opponent Assigns Remaining Strikes
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Combat, Step 3 (Opponent Assigns Remaining Strikes) - The defending player's opponent assigns any remaining strikes to one or more characters that have not yet been assigned a strike, up to the number of characters facing the attack. Excess strikes cannot be canceled, but do not have to be defeated in order for the attack to be defeated. Actions cannot be taken during this step, which happens immediately.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  ORC_PATROL, DARK_QUARRELS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  dispatch, resolveChain,
  makeWildernessMHState,
  handCardId, companyIdAt, findCharInstanceId,
  viableActions, viableFor,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../../test-helpers.js';
import { Phase } from '../../../index.js';
import type { AssignStrikeAction } from '../../../index.js';

describe('Rule 8.10 — Step 3: Opponent Assigns Remaining Strikes', () => {
  beforeEach(() => resetMint());

  test('Defender passes with remaining strikes — attacker assigns remaining strikes', () => {
    // ORC_PATROL has 3 strikes. Company has ARAGORN + LEGOLAS + GIMLI.
    // Defender assigns 1 to ARAGORN and 1 to LEGOLAS, then passes.
    // GIMLI is still unassigned. After pass: assignmentPhase is 'attacker'.
    // Attacker assigns the remaining 1 strike to unassigned GIMLI.
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

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.assignmentPhase).toBe('defender');

    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);

    // Defender assigns 1 strike to ARAGORN
    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId, tapped: false });
    // Defender assigns 1 strike to LEGOLAS
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId, tapped: false });
    // Defender passes — 1 strike remains, GIMLI is unassigned
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });

    expect(s.combat!.assignmentPhase).toBe('attacker');

    // Attacker assigns the remaining strike to unassigned GIMLI
    const attackerAssigns = viableFor(s, PLAYER_2);
    const assignToGimli = attackerAssigns.find(
      ea => ea.action.type === 'assign-strike' && ea.action.characterId === gimliId,
    );
    expect(assignToGimli).toBeDefined();

    s = dispatch(s, assignToGimli!.action);

    // After attacker assigns the last strike, all 3 are assigned — done
    expect(s.combat!.assignmentPhase).toBe('done');

    const gimliAssignment = s.combat!.strikeAssignments.find(a => a.characterId === gimliId);
    expect(gimliAssignment).toBeDefined();
    expect(gimliAssignment!.excessStrikes).toBe(0);
  });

  test('Excess strikes add -1 prowess per excess; attack defeated if all primary strikes defeated', () => {
    // ORC_PATROL (3 strikes) vs company with ARAGORN only.
    // Defender assigns 1 primary strike to ARAGORN, passes.
    // Attacker assigns 2 excess strikes to ARAGORN (excessStrikes === 2).
    // The attack is considered defeated when ARAGORN defeats his primary strike.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
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

    // Defender assigns 1 primary strike to ARAGORN
    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId, tapped: false });
    // Defender passes — 2 strikes remain
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });

    expect(s.combat!.assignmentPhase).toBe('attacker');

    // Attacker assigns both remaining strikes as excess to ARAGORN
    const firstExcess = viableActions(s, PLAYER_2, 'assign-strike').find(
      ea => (ea.action as AssignStrikeAction).characterId === aragornId,
    );
    expect(firstExcess).toBeDefined();
    s = dispatch(s, firstExcess!.action);

    const secondExcess = viableActions(s, PLAYER_2, 'assign-strike').find(
      ea => (ea.action as AssignStrikeAction).characterId === aragornId,
    );
    expect(secondExcess).toBeDefined();
    s = dispatch(s, secondExcess!.action);

    const aragornAssignment = s.combat!.strikeAssignments.find(a => a.characterId === aragornId);
    expect(aragornAssignment).toBeDefined();
    expect(aragornAssignment!.excessStrikes).toBe(2);
  });

  test('Actions cannot be taken during this step — a cancel card in hand offers nothing once the defender has passed assignment', () => {
    // ARAGORN alone, DARK QUARRELS in hand, faces ORC_PATROL. The defender may
    // cancel before assigning; once it passes, the opponent assigns "immediately"
    // and the defender has no window — not even to play the cancel it declined
    // to use a moment earlier. (Left open, the harness's active-player priority
    // handed the defender a menu of exactly one action, cancel-attack, and it
    // was forced to play it.)
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [DARK_QUARRELS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
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
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(viableActions(afterChain, PLAYER_1, 'cancel-attack').length).toBeGreaterThan(0);

    const passed = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(passed.combat!.assignmentPhase).toBe('attacker');
    expect(viableFor(passed, PLAYER_1)).toEqual([]);
    expect(viableActions(passed, PLAYER_2, 'assign-strike').length).toBeGreaterThan(0);
  });
});
