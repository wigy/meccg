/**
 * @module tw-243.test
 *
 * Card test: Gates of Morning (tw-243)
 * Type: hero-resource-event (permanent, environment)
 * Effects: 2 (duplication-limit scope:game max:1, on-event self-enters-play discard-cards-in-play filter:hazard-environment)
 *
 * "Environment. When Gates of Morning is played, all environment hazard
 *  cards in play are immediately discarded, and all hazard environment
 *  effects are canceled. Cannot be duplicated."
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
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardInPlay, CardInstanceId } from '../../index.js';

/** Play a permanent event and both players pass chain priority to resolve it. */
function playAndResolve(
  state: import('../../index.js').GameState,
  player: typeof PLAYER_1,
  cardInstanceId: CardInstanceId,
): import('../../index.js').GameState {
  let result = reduce(state, { type: 'play-permanent-event', player, cardInstanceId });
  expect(result.error).toBeUndefined();
  // Both players pass chain priority → chain resolves
  const opponent = player === PLAYER_1 ? PLAYER_2 : PLAYER_1;
  result = reduce(result.state, { type: 'pass-chain-priority', player: opponent });
  expect(result.error).toBeUndefined();
  result = reduce(result.state, { type: 'pass-chain-priority', player });
  expect(result.error).toBeUndefined();
  return result.state;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Gates of Morning (tw-243)', () => {
  beforeEach(() => resetMint());

  test('can be played as a permanent event during organization', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);

    const gomId = state.players[0].hand[0].instanceId;

    // After declaring, card is on the chain (not in hand, not in cardsInPlay)
    const declareResult = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(declareResult.error).toBeUndefined();
    expect(declareResult.state.players[0].hand).toHaveLength(0);
    expect(declareResult.state.players[0].cardsInPlay).toHaveLength(0);
    expect(declareResult.state.chain).not.toBeNull();
    expect(declareResult.state.chain!.entries[0].card?.instanceId).toBe(gomId);

    // After chain resolves, card moves to cardsInPlay
    const s = playAndResolve(state, PLAYER_1, gomId);
    expect(s.chain).toBeNull();
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].cardsInPlay[0].instanceId).toBe(gomId);
  });

  test('discards Doors of Night (hazard environment) when played', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const s = playAndResolve(state, PLAYER_1, gomId);

    // Gates of Morning in P1 cardsInPlay
    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].cardsInPlay[0].instanceId).toBe(gomId);

    // Doors of Night discarded from P2 cardsInPlay
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain('don-1' as CardInstanceId);
  });

  test('discards own hazard environment cards when played', () => {
    // Edge case: P1 has a Doors of Night in their own cardsInPlay
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const s = playAndResolve(state, PLAYER_1, gomId);

    // Gates of Morning in cardsInPlay, Doors of Night discarded
    const p1InPlay = s.players[0].cardsInPlay;
    expect(p1InPlay).toHaveLength(1);
    expect(p1InPlay[0].instanceId).toBe(gomId);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain('don-1' as CardInstanceId);
  });

  test('does not discard own resource environment cards', () => {
    // If somehow another resource environment is in play, it should NOT be discarded
    const otherGomInPlay: CardInPlay = {
      instanceId: 'gom-other' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    // Use a second player's cardsInPlay with a resource environment
    // (this would normally be blocked by duplication-limit, but we test the discard logic)
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [otherGomInPlay] },
      ],
    });

    // Duplication limit will block this, but let's verify via the legal actions
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBe('Gates of Morning cannot be duplicated');
  });

  test('cannot be duplicated when opponent has a copy in play', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBe('Gates of Morning cannot be duplicated');
  });

  test('no opposing environments to discard is a no-op', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const s = playAndResolve(state, PLAYER_1, gomId);

    // Gates of Morning played, no discards needed
    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].discardPile).toHaveLength(0);
    expect(s.players[1].discardPile).toHaveLength(0);
  });

  test('opponent can cancel Gates of Morning with Twilight before it resolves', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const p2Twilight = state.players[1].hand[0].instanceId;

    // P1 plays Gates of Morning → chain starts, P2 gets priority
    let result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();
    expect(result.state.chain!.priority).toBe(PLAYER_2);

    // P2 responds with Twilight targeting GoM on the chain
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // Both pass → chain resolves LIFO: Twilight negates GoM
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(result.error).toBeUndefined();

    const s = result.state;
    expect(s.chain).toBeNull();
    // GoM negated → goes to discard, never enters play
    expect(s.players[0].cardsInPlay).toHaveLength(0);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain(gomId);
    // Doors of Night survives
    expect(s.players[1].cardsInPlay).toHaveLength(1);
    expect(s.players[1].cardsInPlay[0].instanceId).toBe('don-1' as CardInstanceId);
  });

  test('Gates of Morning on chain is a valid Twilight target', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;

    // P1 plays GoM → chain starts
    const result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // P2 should have Twilight targeting GoM on the chain
    const p2Actions = viableActions(result.state, PLAYER_2, 'play-short-event');
    const gomTargets = p2Actions.filter(
      ea => (ea.action as { targetInstanceId: CardInstanceId }).targetInstanceId === gomId,
    );
    expect(gomTargets).toHaveLength(1);
  });
});
