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
  GATES_OF_MORNING, DOORS_OF_NIGHT, TWILIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
  viableActions,
  P1_COMPANY, makeMHState,
  playHazardAndResolve,
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

    // After declaring, card is on the chain (not in hand, not in cardsInPlay)
    const declareResult = reduce(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(declareResult.error).toBeUndefined();
    expect(declareResult.state.players[1].hand).toHaveLength(0);
    expect(declareResult.state.players[1].cardsInPlay).toHaveLength(0);
    expect(declareResult.state.chain).not.toBeNull();
    expect(declareResult.state.chain!.entries[0].card?.instanceId).toBe(donId);

    // After chain resolves, card moves to cardsInPlay
    const s = playHazardAndResolve(mhGameState, PLAYER_2, donId, P1_COMPANY);
    expect(s.chain).toBeNull();
    expect(s.players[1].hand).toHaveLength(0);
    expect(s.players[1].cardsInPlay).toHaveLength(1);
    expect(s.players[1].cardsInPlay[0].instanceId).toBe(donId);
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
    const s = playHazardAndResolve(mhGameState, PLAYER_2, donId, P1_COMPANY);

    // Doors of Night in P2 cardsInPlay
    expect(s.players[1].cardsInPlay).toHaveLength(1);
    expect(s.players[1].cardsInPlay[0].instanceId).toBe(donId);

    // Gates of Morning discarded from P1 cardsInPlay
    expect(s.players[0].cardsInPlay).toHaveLength(0);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain('gom-1' as CardInstanceId);
  });

  test('discards own resource environment cards when played', () => {
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
    const s = playHazardAndResolve(mhGameState, PLAYER_2, donId, P1_COMPANY);

    // Doors of Night in cardsInPlay, Gates of Morning discarded
    const p2InPlay = s.players[1].cardsInPlay;
    expect(p2InPlay).toHaveLength(1);
    expect(p2InPlay[0].instanceId).toBe(donId);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain('gom-1' as CardInstanceId);
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
    const s = playHazardAndResolve(mhGameState, PLAYER_2, donId, P1_COMPANY);

    // Doors of Night played, no discards needed
    expect(s.players[1].cardsInPlay).toHaveLength(1);
    expect(s.players[0].discardPile).toHaveLength(0);
    expect(s.players[1].discardPile).toHaveLength(0);
  });

  test('P1 responds with Twilight to cancel Doors of Night before it discards Gates of Morning', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = mhGameState.players[1].hand[0].instanceId;
    const p1Twilight = mhGameState.players[0].hand[0].instanceId;

    // P2 plays DoN → chain starts, P1 gets priority
    let result = reduce(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(result.error).toBeUndefined();
    expect(result.state.chain!.priority).toBe(PLAYER_1);

    // P1 responds with Twilight targeting DoN on the chain
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: p1Twilight, targetInstanceId: donId });
    expect(result.error).toBeUndefined();

    // Both pass → chain resolves LIFO: Twilight negates DoN
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const s = result.state;
    expect(s.chain).toBeNull();
    // DoN negated → goes to discard, never enters play
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain(donId);
    // Gates of Morning survives
    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].cardsInPlay[0].instanceId).toBe('gom-1' as CardInstanceId);
  });
});
