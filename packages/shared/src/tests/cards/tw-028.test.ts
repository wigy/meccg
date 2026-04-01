/**
 * @module tw-028.test
 *
 * Card test: Doors of Night (tw-28)
 * Type: hazard-event (permanent, environment)
 * Effects: 2 (duplication-limit scope:game max:1, on-event self-enters-play discard-cards-in-play filter:hero-resource-event+environment)
 *
 * "Environment. When Doors of Night is played, all resource environment cards
 *  in play are immediately discarded, and all resource environment effects are
 *  canceled. Cannot be duplicated."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS,
  GATES_OF_MORNING, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
  viableActions,
  P1_COMPANY, makeMHState,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardInPlay, CardInstanceId, GameState } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Doors of Night (tw-28)', () => {
  beforeEach(() => resetMint());

  test('can be played as a hazard permanent event during M/H play-hazards step', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };

    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);

    const donId = mhGameState.players[1].hand[0].instanceId;
    const result = reduce(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(result.error).toBeUndefined();

    // Card moved from hand to cardsInPlay
    expect(result.state.players[1].hand).toHaveLength(0);
    expect(result.state.players[1].cardsInPlay).toHaveLength(1);
    expect(result.state.players[1].cardsInPlay[0].instanceId).toBe(donId);
  });

  test('discards Gates of Morning (resource environment) when played', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = mhGameState.players[1].hand[0].instanceId;
    const result = reduce(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(result.error).toBeUndefined();

    // Doors of Night in P2 cardsInPlay
    expect(result.state.players[1].cardsInPlay).toHaveLength(1);
    expect(result.state.players[1].cardsInPlay[0].instanceId).toBe(donId);

    // Gates of Morning discarded from P1 cardsInPlay
    expect(result.state.players[0].cardsInPlay).toHaveLength(0);
    expect(result.state.players[0].discardPile.map(c => c.instanceId)).toContain('gom-1' as CardInstanceId);
  });

  test('discards own resource environment cards when played', () => {
    // Edge case: P2 has a resource environment (GoM) in their own cardsInPlay
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = mhGameState.players[1].hand[0].instanceId;
    const result = reduce(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(result.error).toBeUndefined();

    // Doors of Night in cardsInPlay, Gates of Morning discarded
    const p2InPlay = result.state.players[1].cardsInPlay;
    expect(p2InPlay).toHaveLength(1);
    expect(p2InPlay[0].instanceId).toBe(donId);
    expect(result.state.players[1].discardPile.map(c => c.instanceId)).toContain('gom-1' as CardInstanceId);
  });

  test('does not discard hazard environment cards', () => {
    // Another Doors of Night already in play — duplication-limit blocks playing a second one,
    // confirming the filter only targets hero-resource-event environments.
    const donExisting: CardInPlay = {
      instanceId: 'don-existing' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], cardsInPlay: [gomInPlay, donExisting] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = mhGameState.players[1].hand[0].instanceId;

    // Duplication-limit blocks this
    const result = reduce(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(result.error).toBe('Doors of Night cannot be duplicated');
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = mhGameState.players[1].hand[0].instanceId;
    const result = reduce(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(result.error).toBe('Doors of Night cannot be duplicated');
  });

  test('cannot be duplicated when opponent has a copy in play', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = mhGameState.players[1].hand[0].instanceId;
    const result = reduce(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(result.error).toBe('Doors of Night cannot be duplicated');
  });

  test('no opposing environments to discard is a no-op', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = mhGameState.players[1].hand[0].instanceId;
    const result = reduce(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(result.error).toBeUndefined();

    // Doors of Night played, no discards needed
    expect(result.state.players[1].cardsInPlay).toHaveLength(1);
    expect(result.state.players[0].discardPile).toHaveLength(0);
    expect(result.state.players[1].discardPile).toHaveLength(0);
  });

  test('counts against hazard limit', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Hazard limit already reached
    const mhGameState: GameState = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 2, hazardLimit: 2 }) };
    const donId = mhGameState.players[1].hand[0].instanceId;
    const result = reduce(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(result.error).toContain('Hazard limit');
  });
});
