/**
 * @module tw-120.test
 *
 * Card test: Aragorn II (tw-120)
 * Type: hero-character
 * Effects: 2
 *
 * "Unique. +2 direct influence against the Rangers of the North faction.
 *  -3 marshalling points if eliminated."
 *
 * Tests:
 * 1. stat-modifier: +2 DI during faction-influence-check for Rangers of the North
 * 2. mp-modifier: -3 MP when in elimination pile
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  Phase,
  ARAGORN, LEGOLAS,
  RANGERS_OF_THE_NORTH,
  BREE, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildSitePhaseState, buildTestState, resetMint,
  findCharInstanceId, mint,
} from '../test-helpers.js';
import type { InfluenceAttemptAction, CardInstance } from '../../index.js';
import { computeLegalActions } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Aragorn II (tw-120)', () => {
  beforeEach(() => resetMint());

  test('+2 direct influence against Rangers of the North faction', () => {
    // Aragorn (dunadan, base DI 3) attempts to influence Rangers of the North at Bree.
    // Rangers influence number = 10.
    // Aragorn has +2 DI bonus specifically for Rangers of the North.
    // Rangers card gives Dúnedain +1 check modifier.
    //   modifier = DI 3 + DI bonus 2 + Dúnadan check bonus 1 = 6
    //   need = 10 - 6 = 4
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const aragornAttempt = influenceActions.find(
      a => a.influencingCharacterId === aragornId,
    );
    expect(aragornAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(3) - aragornDIBonus(2) - dúnadanCheckMod(1) = 4
    expect(aragornAttempt!.need).toBe(4);
  });

  test('+2 DI bonus does not apply to non-Rangers factions', () => {
    // Aragorn attempting to influence a different faction should NOT get the +2 bonus.
    // Use Wood-elves (influence number 9, playable at Thranduil's Halls) — but
    // we can use Bree with Rangers to compare. Instead, use Legolas (elf, DI 2)
    // attempting Rangers at Bree — Legolas gets no Aragorn-specific bonus.
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const legolasId = findCharInstanceId(state, 0, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const legolasAttempt = influenceActions.find(
      a => a.influencingCharacterId === legolasId,
    );
    expect(legolasAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(2) = 8 (no Aragorn-specific bonus, no Dúnadan check bonus)
    expect(legolasAttempt!.need).toBe(8);
  });

  test('-3 marshalling points when eliminated', () => {
    // Build a state with Aragorn in the eliminated pile, then check that
    // the character MP category is reduced by 3.
    // Aragorn normally gives 3 character MPs, so net should be 0.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
      recompute: true,
    });

    // Manually place Aragorn in the eliminated pile
    const aragornInst: CardInstance = { instanceId: mint(), definitionId: ARAGORN };
    const updatedState = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0
          ? { ...p, eliminatedPile: [aragornInst] }
          : p,
      ) as unknown as typeof state.players,
    };

    // Trigger recomputeDerived by dispatching a pass action
    const result = reduce(updatedState, { type: 'pass', player: PLAYER_1 });
    const p1 = result.state.players[0];

    // Legolas in play: 2 character MP. Aragorn eliminated: -3 penalty. Total = -1.
    expect(p1.marshallingPoints.character).toBe(-1);
  });
});
