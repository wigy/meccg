/**
 * @module le-89.test
 *
 * Card test: Sellswords Between Charters (le-89)
 * Type: hazard-creature
 * Effects: none
 *
 * "Men. Two strikes."
 *
 * Shape: prowess 11, strikes 2, body —, keyed to {B}{S} (border-hold or
 * shadow-hold destination), race Men, 1 kill-MP, non-unique.
 *
 * No special DSL effects. Race and strike count are structural attributes.
 * Tests verify:
 * 1. Card is playable (viable play-hazard action offered) at a border-hold destination.
 * 2. Card is playable at a shadow-hold destination.
 * 3. Card is NOT playable when destination is ruins-and-lairs.
 * 4. When played at a border-hold, combat initiates with 2 strikes and
 *    standard defender-chooses assignment (no attacker-chooses effect).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH, BREE,
  buildTestState, resetMint, makeMHState, makeShadowMHState, makeWildernessMHState,
  resolveChain,
  handCardId, companyIdAt, dispatch, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const SELLSWORDS = 'le-89' as CardDefinitionId;

describe('Sellswords Between Charters (le-89)', () => {
  beforeEach(() => resetMint());

  test('viable play-hazard action offered at border-hold destination', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [SELLSWORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const gameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      }),
    };

    const actions = computeLegalActions(gameState, PLAYER_2);
    const playActions = actions.filter(a => a.viable && a.action.type === 'play-hazard');
    expect(playActions).toHaveLength(1);
  });

  test('viable play-hazard action offered at shadow-hold destination', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [SELLSWORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const gameState = { ...state, phaseState: makeShadowMHState() };

    const actions = computeLegalActions(gameState, PLAYER_2);
    const playActions = actions.filter(a => a.viable && a.action.type === 'play-hazard');
    expect(playActions).toHaveLength(1);
  });

  test('no play-hazard action offered at ruins-and-lairs destination', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [SELLSWORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const gameState = { ...state, phaseState: makeWildernessMHState() };

    const actions = computeLegalActions(gameState, PLAYER_2);
    const playActions = actions.filter(a => a.viable && a.action.type === 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  test('combat initiates with 2 strikes and defender assigns (no attacker-chooses)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [SELLSWORDS],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const gameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      }),
    };

    const sellswordsId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: sellswordsId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(11);

    // Defender assigns strikes — PLAYER_1 has assign-strike actions
    const defenderActions = computeLegalActions(afterChain, PLAYER_1);
    const defAssignActions = defenderActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(defAssignActions.length).toBeGreaterThan(0);

    // Attacker does NOT assign — no combat-attacker-chooses-defenders effect
    const attackerActions = computeLegalActions(afterChain, PLAYER_2);
    const attAssignActions = attackerActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(attAssignActions).toHaveLength(0);
  });
});
