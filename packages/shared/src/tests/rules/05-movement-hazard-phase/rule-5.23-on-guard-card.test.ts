/**
 * @module rule-5.23-on-guard-card
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.23: Placing an On-Guard Card
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Placing an On-Guard Card - As an action during a company's movement/hazard phase, the hazard player may place any one card from their hand "on-guard" on the company's new site. The card is declared as a hazard against the company and is placed face-down at the site (and is no longer considered to be in the hazard player's hand). Placing a card on-guard counts as one against the hazard limit, may be done in response, and can only be done once per movement/hazard phase.
 * If a card is legally declared as being placed on-guard but then exceeds the hazard limit upon resolution, it is returned to its player's hand instead of being discarded.
 * If a site with an on-guard card on it leaves play, the on-guard card returns to the hazard player's hand.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, dispatch,
  PLAYER_1, PLAYER_2, makeMHState, viableActions,
  LEGOLAS, ARAGORN,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT, GLAMDRING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  handCardId,
} from '../../test-helpers.js';
import type { PlaceOnGuardAction } from '../../../index.js';

describe('Rule 5.23 — Placing an On-Guard Card', () => {
  beforeEach(() => resetMint());

  test('hazard player can place any card from hand face-down on-guard (bluffing allowed)', () => {
    // GLAMDRING is a resource item — placing it on-guard is a bluff, but still legal.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE, GLAMDRING], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhGameState = { ...state, phaseState: makeMHState() };

    const ogActions = viableActions(mhGameState, PLAYER_2, 'place-on-guard');

    // Both cards should be eligible — any hand card can be placed on-guard
    expect(ogActions).toHaveLength(2);
    const cardIds = ogActions.map(ea => (ea.action as PlaceOnGuardAction).cardInstanceId);
    expect(cardIds).toContain(handCardId(mhGameState, 1, 0));
    expect(cardIds).toContain(handCardId(mhGameState, 1, 1));
  });

  test('placing on-guard removes card from hand, adds to company onGuardCards, and counts against hazard limit', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE, ORC_PATROL], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhGameState = { ...state, phaseState: makeMHState() };

    const cardToPlace = handCardId(mhGameState, 1);
    const nextState = dispatch(mhGameState, {
      type: 'place-on-guard',
      player: PLAYER_2,
      cardInstanceId: cardToPlace,
    });

    // Card removed from hazard player's hand
    expect(nextState.players[1].hand).toHaveLength(1);
    expect(nextState.players[1].hand.find(c => c.instanceId === cardToPlace)).toBeUndefined();

    // Card added to resource player's company onGuardCards
    expect(nextState.players[0].companies[0].onGuardCards).toHaveLength(1);
    expect(nextState.players[0].companies[0].onGuardCards[0].instanceId).toBe(cardToPlace);

    // Hazard count incremented
    const ps = nextState.phaseState as ReturnType<typeof makeMHState>;
    expect(ps.hazardsPlayedThisCompany).toBe(1);
  });

  test('only one on-guard card per company per M/H phase', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE, ORC_PATROL], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhGameState = { ...state, phaseState: makeMHState() };

    // Place first on-guard card
    const firstCard = handCardId(mhGameState, 1);
    const afterFirst = dispatch(mhGameState, {
      type: 'place-on-guard',
      player: PLAYER_2,
      cardInstanceId: firstCard,
    });

    // No more on-guard actions should be available
    const ogActions = viableActions(afterFirst, PLAYER_2, 'place-on-guard');
    expect(ogActions).toHaveLength(0);
  });

  test('on-guard placement is blocked when hazard limit is reached', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhGameState = {
      ...state,
      phaseState: makeMHState({ hazardsPlayedThisCompany: 2, hazardLimitAtReveal: 2 }),
    };

    // On-guard actions exist but are not viable (limit reached)
    const ogActions = viableActions(mhGameState, PLAYER_2, 'place-on-guard');
    expect(ogActions).toHaveLength(0);
  });

  test('resource player pass is reset after on-guard placement', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhGameState = {
      ...state,
      phaseState: makeMHState({ resourcePlayerPassed: true }),
    };

    const cardId = handCardId(mhGameState, 1);
    const nextState = dispatch(mhGameState, {
      type: 'place-on-guard',
      player: PLAYER_2,
      cardInstanceId: cardId,
    });

    // Resource player's pass should be reset so they can respond
    const ps = nextState.phaseState as ReturnType<typeof makeMHState>;
    expect(ps.resourcePlayerPassed).toBe(false);
  });
});
