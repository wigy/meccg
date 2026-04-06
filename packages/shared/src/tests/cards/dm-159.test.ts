/**
 * @module dm-159.test
 *
 * Card test: Smoke Rings (dm-159)
 * Type: hero-resource-event (short)
 * Effects: 1 (fetch-to-deck from sideboard/discard-pile)
 *
 * "Bring one resource or character from your sideboard or discard pile
 *  into your play deck and shuffle."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS, SMOKE_RINGS,
  GLAMDRING, STING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { LongEventPhaseState } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Smoke Rings (dm-159)', () => {
  beforeEach(() => resetMint());

  test('appears as playable resource short-event in long-event phase', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-resource-short-event');
    expect(playActions).toHaveLength(1);
    expect(playActions[0].action.type).toBe('play-resource-short-event');
  });

  test('playing Smoke Rings moves it to discard and enters fetch sub-flow', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-resource-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId });
    expect(result.error).toBeUndefined();

    // Smoke Rings moved from hand to discard
    expect(result.state.players[0].hand).toHaveLength(0);
    expect(result.state.players[0].discardPile.map(c => c.instanceId)).toContain(smokeRingsId);

    // Fetch sub-flow is active
    const leState = result.state.phaseState as LongEventPhaseState;
    expect(leState.pendingFetch).not.toBeNull();
    expect(leState.pendingFetch!.sources).toContain('sideboard');
    expect(leState.pendingFetch!.sources).toContain('discard-pile');
  });

  test('fetch sub-flow shows eligible cards from sideboard', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING, STING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Play Smoke Rings
    const smokeRingsId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-resource-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId });
    expect(result.error).toBeUndefined();

    // Fetch actions: 2 sideboard cards + Smoke Rings itself from discard
    const fetchActions = viableActions(result.state, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(3);
    const sideboardFetches = fetchActions.filter(
      ea => (ea.action as { source: string }).source === 'sideboard',
    );
    expect(sideboardFetches).toHaveLength(2);
  });

  test('fetch sub-flow shows eligible cards from discard pile', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], discardPile: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Play Smoke Rings
    const smokeRingsId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-resource-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId });
    expect(result.error).toBeUndefined();

    // Fetch actions: Glamdring + Smoke Rings itself, both from discard pile
    const fetchActions = viableActions(result.state, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(2);
    // Both from discard pile
    for (const ea of fetchActions) {
      expect((ea.action as { source: string }).source).toBe('discard-pile');
    }
  });

  test('fetching a card from sideboard adds it to play deck and shuffles', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = state.players[0].hand[0].instanceId;
    const glamdringId = state.players[0].sideboard[0].instanceId;
    const originalDeckSize = state.players[0].playDeck.length;

    // Play Smoke Rings
    let result = reduce(state, { type: 'play-resource-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId });
    expect(result.error).toBeUndefined();

    // Fetch Glamdring from sideboard
    result = reduce(result.state, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: glamdringId,
      source: 'sideboard',
    });
    expect(result.error).toBeUndefined();

    // Glamdring is now in the play deck
    expect(result.state.players[0].playDeck.length).toBe(originalDeckSize + 1);
    expect(result.state.players[0].playDeck.map(c => c.instanceId)).toContain(glamdringId);

    // Sideboard no longer contains Glamdring
    expect(result.state.players[0].sideboard).toHaveLength(0);

    // Fetch sub-flow is cleared
    const leState = result.state.phaseState as LongEventPhaseState;
    expect(leState.pendingFetch).toBeNull();
  });

  test('fetching a card from discard pile adds it to play deck and shuffles', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], discardPile: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = state.players[0].hand[0].instanceId;
    const glamdringId = state.players[0].discardPile[0].instanceId;
    const originalDeckSize = state.players[0].playDeck.length;

    // Play Smoke Rings
    let result = reduce(state, { type: 'play-resource-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId });
    expect(result.error).toBeUndefined();

    // Fetch Glamdring from discard pile
    result = reduce(result.state, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: glamdringId,
      source: 'discard-pile',
    });
    expect(result.error).toBeUndefined();

    // Glamdring moved from discard to play deck
    expect(result.state.players[0].playDeck.length).toBe(originalDeckSize + 1);
    expect(result.state.players[0].playDeck.map(c => c.instanceId)).toContain(glamdringId);

    // Discard pile only contains Smoke Rings now (Glamdring was removed)
    expect(result.state.players[0].discardPile.map(c => c.instanceId)).toContain(smokeRingsId);
    expect(result.state.players[0].discardPile.map(c => c.instanceId)).not.toContain(glamdringId);

    // Fetch sub-flow is cleared
    const leState = result.state.phaseState as LongEventPhaseState;
    expect(leState.pendingFetch).toBeNull();
  });

  test('pass during fetch sub-flow skips the fetch', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = state.players[0].hand[0].instanceId;

    // Play Smoke Rings
    let result = reduce(state, { type: 'play-resource-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId });
    expect(result.error).toBeUndefined();

    // Pass to skip fetch
    result = reduce(result.state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    // Fetch sub-flow cleared, still in long-event phase
    const leState = result.state.phaseState as LongEventPhaseState;
    expect(leState.phase).toBe(Phase.LongEvent);
    expect(leState.pendingFetch).toBeNull();

    // Sideboard unchanged
    expect(result.state.players[0].sideboard).toHaveLength(1);
  });

  test('non-resource/character cards in sideboard are not eligible for fetch', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = state.players[0].hand[0].instanceId;

    // Play Smoke Rings
    const result = reduce(state, { type: 'play-resource-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId });
    expect(result.error).toBeUndefined();

    // Only Smoke Rings itself (a resource event in discard) is eligible; MORIA (site) is not
    const fetchActions = viableActions(result.state, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);
    // The one eligible card is Smoke Rings from discard-pile
    expect((fetchActions[0].action as { source: string }).source).toBe('discard-pile');

    // Pass is still available
    const passActions = viableActions(result.state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  test('opponent has no actions during fetch sub-flow', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-resource-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId });
    expect(result.error).toBeUndefined();

    const opponentActions = computeLegalActions(result.state, PLAYER_2);
    expect(opponentActions).toHaveLength(0);
  });

  test('after fetch completes, normal long-event actions resume', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = state.players[0].hand[0].instanceId;
    const glamdringId = state.players[0].sideboard[0].instanceId;

    // Play Smoke Rings and fetch
    let result = reduce(state, { type: 'play-resource-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: glamdringId,
      source: 'sideboard',
    });
    expect(result.error).toBeUndefined();

    // Still in long-event phase, pass is available
    const passActions = viableActions(result.state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);

    // Can pass to advance to M/H phase
    result = reduce(result.state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.phaseState.phase).toBe(Phase.MovementHazard);
  });
});
