/**
 * @module le-77.test
 *
 * Card test: Hobgoblins (le-77)
 * Type: hazard-creature
 * Effects: 0 (no special effects)
 *
 * "Orcs. Two strikes."
 *
 * A straightforward orc creature keyed to double wilderness
 * ({w}{w}). No special combat rules — defender assigns strikes
 * normally, 2 strikes at prowess 10 with no body.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  HOBGOBLINS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  findCharInstanceId, viableActions,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch, expectCharStatus, RESOURCE_PLAYER, HAZARD_PLAYER,
  expectCharInPlay,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType, CardStatus } from '../../index.js';
// ─── Constants ──────────────────────────────────────────────────────────────

const WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };

// ─── Helpers ────────────────────────────────────────────────────────────────

const MH_STATE = {
  resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
  resolvedSitePathNames: ['Fangorn', 'Redhorn Gate'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Moria',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Hobgoblins (le-77)', () => {
  beforeEach(() => resetMint());


  test('combat initiates with 2 strikes and prowess 10', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [HOBGOBLINS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_STATE) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      gameState, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(10);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  test('defender assigns strikes (no attacker-chooses-defenders)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [HOBGOBLINS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_STATE) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      gameState, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    const defenderActions = computeLegalActions(afterChain, PLAYER_1);
    const assignActions = defenderActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(assignActions.length).toBeGreaterThan(0);
  });

  test('both characters defeat Hobgoblins with high strike rolls', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [HOBGOBLINS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_STATE) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      gameState, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING,
    );

    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    // Assign both strikes
    let current = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    current = dispatch(current, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });

    // Choose strike order and resolve first strike (high roll → wins)
    const orderActions = viableActions(current, PLAYER_1, 'choose-strike-order');
    if (orderActions.length > 0) {
      current = dispatch(current, orderActions[0].action);
    }
    let resolveActions = viableActions({ ...current, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    current = dispatch({ ...current, cheatRollTotal: 12 }, resolveActions[0].action);

    // Resolve second strike (high roll → wins)
    resolveActions = viableActions({ ...current, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    if (resolveActions.length > 0) {
      current = dispatch({ ...current, cheatRollTotal: 12 }, resolveActions[0].action);
    }

    expect(current.combat).toBeNull();

    expectCharStatus(current, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expectCharStatus(current, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);
  });

  test('character wounded by Hobgoblins survives body check', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [HOBGOBLINS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const gameState = { ...state, phaseState: makeMHState(MH_STATE) };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      gameState, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING,
    );

    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    // Assign both strikes
    let current = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    current = dispatch(current, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });

    // Choose strike order, resolve Aragorn first with low roll → wounded
    const orderActions = viableActions(current, PLAYER_1, 'choose-strike-order');
    if (orderActions.length > 0) {
      const aragornOrder = orderActions.find(a => 'characterId' in a.action && a.action.characterId === aragornId);
      current = dispatch(current, (aragornOrder ?? orderActions[0]).action);
    }

    // Resolve Aragorn's strike: low roll → wounded
    let resolveActions = viableActions({ ...current, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    current = dispatch({ ...current, cheatRollTotal: 2 }, resolveActions[0].action);

    // Body check: roll 5 ≤ body 9 → survives wounded
    if (current.combat?.phase === 'body-check') {
      const bodyActions = viableActions(current, PLAYER_2, 'body-check-roll');
      expect(bodyActions.length).toBeGreaterThan(0);
      current = dispatch({ ...current, cheatRollTotal: 5 }, bodyActions[0].action);
    }

    // Resolve Legolas's strike: high roll → wins
    resolveActions = viableActions({ ...current, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    if (resolveActions.length > 0) {
      current = dispatch({ ...current, cheatRollTotal: 12 }, resolveActions[0].action);
    }

    expect(current.combat).toBeNull();

    expectCharStatus(current, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
    expectCharStatus(current, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);
    // Still verify char instance IDs preserved
    expectCharInPlay(current, RESOURCE_PLAYER, aragornId);
    expectCharInPlay(current, RESOURCE_PLAYER, legolasId);
  });
});
