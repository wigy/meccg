/**
 * @module tw-021.test
 *
 * Card test: Choking Shadows (tw-21)
 * Type: hazard-event (short, environment)
 * Effects: 1 (duplication-limit scope:game max:1)
 *
 * "Environment. Modify the prowess of one automatic-attack at a Ruins & Lairs
 *  site by +2. Alternatively, if Doors of Night is in play, treat one
 *  Wilderness as a Shadow-land or one Ruins & Lairs as a Shadow-hold until
 *  the end of the turn. Cannot be duplicated."
 *
 * Engine support: Only the duplication-limit is currently implemented.
 * The prowess modification and region-type transformation require engine
 * features not yet available (short-event persistent effects, resolver
 * site-type context, region-type override constraints).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS,
  CHOKING_SHADOWS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, makeMHState,
  P1_COMPANY,
  handCardId, dispatch, playHazardAndResolve,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { GameState, HazardEventCard } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Choking Shadows (tw-21)', () => {
  beforeEach(() => resetMint());

  test('card definition is a short hazard event with environment keyword', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const def = state.cardPool[CHOKING_SHADOWS as string] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('short');
    expect(def.keywords).toContain('environment');
    expect(def.effects).toHaveLength(1);
    expect(def.effects![0].type).toBe('duplication-limit');
  });

  test('can be played as a hazard short event during M/H play-hazards step', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('goes to discard pile after play (short event)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const csId = handCardId(mhGameState, 1);
    const s = playHazardAndResolve(mhGameState, PLAYER_2, csId, P1_COMPANY);

    expect(s.players[1].hand).toHaveLength(0);
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain(csId);
  });

  test('cannot be duplicated — second copy rejected while first is on chain', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS, CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const cs1Id = handCardId(mhGameState, 1, 0);

    // Play first copy → enters chain
    const afterFirst = dispatch(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: cs1Id, targetCompanyId: P1_COMPANY });
    expect(afterFirst.chain).not.toBeNull();

    // Second copy should be rejected
    const cs2Id = handCardId(mhGameState, 1, 1);
    const result = reduce(afterFirst, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: cs2Id, targetCompanyId: P1_COMPANY });
    expect(result.error).toBe('Choking Shadows cannot be duplicated');
  });

  test('second copy can be played after first resolves (no longer on chain)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS, CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const cs1Id = handCardId(mhGameState, 1, 0);

    // Play and resolve first copy
    const afterResolve = playHazardAndResolve(mhGameState, PLAYER_2, cs1Id, P1_COMPANY);
    expect(afterResolve.chain).toBeNull();
    expect(afterResolve.players[1].discardPile.map(c => c.instanceId)).toContain(cs1Id);

    // Second copy is playable (first is in discard, not on chain or in play)
    const actions = viableActions(afterResolve, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('counts against hazard limit', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CHOKING_SHADOWS], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({ hazardsPlayedThisCompany: 4, hazardLimit: 4 }),
    };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });
});
