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
  reduce, pool, findCharInstanceId, viableActions,
  playCreatureHazardAndResolve,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import type { CreatureCard } from '../../index.js';

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

  test('card definition has correct stats and no effects', () => {
    const def = pool[HOBGOBLINS as string] as CreatureCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-creature');
    expect(def.name).toBe('Hobgoblins');
    expect(def.race).toBe('orc');
    expect(def.unique).toBe(false);
    expect(def.strikes).toBe(2);
    expect(def.prowess).toBe(10);
    expect(def.body).toBeNull();
    expect(def.killMarshallingPoints).toBe(1);
    expect(def.effects).toEqual([]);
  });

  test('keyed to double wilderness', () => {
    const def = pool[HOBGOBLINS as string] as CreatureCard;
    expect(def.keyedTo).toBeDefined();
    expect(def.keyedTo).toHaveLength(1);
    expect(def.keyedTo[0].regionTypes).toEqual(['wilderness', 'wilderness']);
  });

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

    const creatureId = gameState.players[1].hand[0].instanceId;
    const companyId = gameState.players[0].companies[0].id;
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

    const creatureId = gameState.players[1].hand[0].instanceId;
    const companyId = gameState.players[0].companies[0].id;
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

    const creatureId = gameState.players[1].hand[0].instanceId;
    const companyId = gameState.players[0].companies[0].id;
    const afterChain = playCreatureHazardAndResolve(
      gameState, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING,
    );

    const aragornId = findCharInstanceId(afterChain, 0, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, 0, LEGOLAS);

    // Assign both strikes
    let result = reduce(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    expect(result.error).toBeUndefined();

    // Choose strike order and resolve first strike (high roll → wins)
    const orderActions = viableActions(result.state, PLAYER_1, 'choose-strike-order');
    if (orderActions.length > 0) {
      result = reduce(result.state, orderActions[0].action);
      expect(result.error).toBeUndefined();
    }
    let resolveActions = viableActions({ ...result.state, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    result = reduce({ ...result.state, cheatRollTotal: 12 }, resolveActions[0].action);
    expect(result.error).toBeUndefined();

    // Resolve second strike (high roll → wins)
    resolveActions = viableActions({ ...result.state, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    if (resolveActions.length > 0) {
      result = reduce({ ...result.state, cheatRollTotal: 12 }, resolveActions[0].action);
      expect(result.error).toBeUndefined();
    }

    expect(result.state.combat).toBeNull();

    expect(result.state.players[0].characters[aragornId as string]).toBeDefined();
    expect(result.state.players[0].characters[aragornId as string].status).toBe(CardStatus.Tapped);
    expect(result.state.players[0].characters[legolasId as string]).toBeDefined();
    expect(result.state.players[0].characters[legolasId as string].status).toBe(CardStatus.Tapped);
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

    const creatureId = gameState.players[1].hand[0].instanceId;
    const companyId = gameState.players[0].companies[0].id;
    const afterChain = playCreatureHazardAndResolve(
      gameState, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING,
    );

    const aragornId = findCharInstanceId(afterChain, 0, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, 0, LEGOLAS);

    // Assign both strikes
    let result = reduce(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    expect(result.error).toBeUndefined();

    // Choose strike order, resolve Aragorn first with low roll → wounded
    const orderActions = viableActions(result.state, PLAYER_1, 'choose-strike-order');
    if (orderActions.length > 0) {
      const aragornOrder = orderActions.find(a => 'characterId' in a.action && a.action.characterId === aragornId);
      result = reduce(result.state, (aragornOrder ?? orderActions[0]).action);
      expect(result.error).toBeUndefined();
    }

    // Resolve Aragorn's strike: low roll → wounded
    let resolveActions = viableActions({ ...result.state, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    result = reduce({ ...result.state, cheatRollTotal: 2 }, resolveActions[0].action);
    expect(result.error).toBeUndefined();

    // Body check: roll 5 ≤ body 9 → survives wounded
    if (result.state.combat?.phase === 'body-check') {
      const bodyActions = viableActions(result.state, PLAYER_2, 'body-check-roll');
      expect(bodyActions.length).toBeGreaterThan(0);
      result = reduce({ ...result.state, cheatRollTotal: 5 }, bodyActions[0].action);
      expect(result.error).toBeUndefined();
    }

    // Resolve Legolas's strike: high roll → wins
    resolveActions = viableActions({ ...result.state, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    if (resolveActions.length > 0) {
      result = reduce({ ...result.state, cheatRollTotal: 12 }, resolveActions[0].action);
      expect(result.error).toBeUndefined();
    }

    expect(result.state.combat).toBeNull();

    expect(result.state.players[0].characters[aragornId as string]).toBeDefined();
    expect(result.state.players[0].characters[aragornId as string].status).toBe(CardStatus.Inverted);
    expect(result.state.players[0].characters[legolasId as string]).toBeDefined();
    expect(result.state.players[0].characters[legolasId as string].status).toBe(CardStatus.Tapped);
  });
});
