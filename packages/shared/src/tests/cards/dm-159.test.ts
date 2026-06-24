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
  ARAGORN, LEGOLAS, SMOKE_RINGS,
  GLAMDRING, STING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, actionAs,
  handCardId, dispatch, resolveChain, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { FetchFromPileAction } from '../../index.js';

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

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    expect(playActions[0].action.type).toBe('play-short-event');
  });

  // Regression (game mqs3008i-sexowp, seq 94, bug-report 9474aaebe1f02b18):
  // Smoke Rings was resolving immediately on play, skipping the chain of
  // effects — the opponent never got a window to respond. Per CRF 22 (which
  // errata the word "immediately" out of the card) and CoE 9.4/9.5, the play
  // must be declared on the chain like any other short event.
  test('playing Smoke Rings initiates a chain so the opponent can respond', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const afterPlay = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId });

    // A chain is now active, carrying Smoke Rings — it has NOT resolved yet.
    expect(afterPlay.chain).not.toBeNull();
    expect(afterPlay.players[0].hand).toHaveLength(0);
    expect(afterPlay.pendingEffects).toHaveLength(0);

    // The opponent holds priority and may respond before the fetch resolves.
    const opponentActions = computeLegalActions(afterPlay, PLAYER_2);
    expect(opponentActions.some(ea => ea.action.type === 'pass-chain-priority')).toBe(true);
  });

  test('after both players pass priority, Smoke Rings enters the fetch sub-flow', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const afterPlay = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId });
    const next = resolveChain(afterPlay);

    // Chain resolved; Smoke Rings is in cardsInPlay while the effect resolves
    expect(next.chain).toBeNull();
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].cardsInPlay.map(c => c.instanceId)).toContain(smokeRingsId);
    expect(next.players[0].discardPile.map(c => c.instanceId)).not.toContain(smokeRingsId);

    // Effect sub-flow is active with fetch-to-deck effect
    expect(next.pendingEffects).toHaveLength(1);
    expect(next.pendingEffects[0].type).toBe('card-effect');
    expect(next.pendingEffects[0].effect.type).toBe('fetch-to-deck');
    expect(next.pendingEffects[0].cardInstanceId).toBe(smokeRingsId);
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

    // Play Smoke Rings and resolve the chain into the fetch sub-flow
    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const next = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // Fetch actions: 2 sideboard cards (Smoke Rings is in cardsInPlay, not in any player pile)
    const fetchActions = viableActions(next, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(2);
    const sideboardFetches = fetchActions.filter(
      ea => actionAs<FetchFromPileAction>(ea.action).source === 'sideboard',
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

    // Play Smoke Rings and resolve the chain into the fetch sub-flow
    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const next = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // Fetch actions: Glamdring from discard pile (Smoke Rings is in cardsInPlay)
    const fetchActions = viableActions(next, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);
    expect(actionAs<FetchFromPileAction>(fetchActions[0].action).source).toBe('discard-pile');
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

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const glamdringId = state.players[0].sideboard[0].instanceId;
    const originalDeckSize = state.players[0].playDeck.length;

    // Play Smoke Rings and resolve the chain into the fetch sub-flow
    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // Fetch Glamdring from sideboard
    const afterFetch = dispatch(afterPlay, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: glamdringId,
      source: 'sideboard',
    });

    // Glamdring is now in the play deck
    expect(afterFetch.players[0].playDeck.length).toBe(originalDeckSize + 1);
    expect(afterFetch.players[0].playDeck.map(c => c.instanceId)).toContain(glamdringId);

    // Sideboard no longer contains Glamdring
    expect(afterFetch.players[0].sideboard).toHaveLength(0);

    // Smoke Rings moved from cardsInPlay to discard after fetch resolved
    expect(afterFetch.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(smokeRingsId);
    expect(afterFetch.players[0].discardPile.map(c => c.instanceId)).toContain(smokeRingsId);

    // Effect sub-flow is cleared
    expect(afterFetch.pendingEffects).toHaveLength(0);
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

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const glamdringId = state.players[0].discardPile[0].instanceId;
    const originalDeckSize = state.players[0].playDeck.length;

    // Play Smoke Rings and resolve the chain into the fetch sub-flow
    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // Fetch Glamdring from discard pile
    const afterFetch = dispatch(afterPlay, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: glamdringId,
      source: 'discard-pile',
    });

    // Glamdring moved from discard to play deck
    expect(afterFetch.players[0].playDeck.length).toBe(originalDeckSize + 1);
    expect(afterFetch.players[0].playDeck.map(c => c.instanceId)).toContain(glamdringId);

    // Discard pile contains Smoke Rings (moved from cardsInPlay after fetch resolved)
    // Glamdring was moved to play deck
    expect(afterFetch.players[0].discardPile.map(c => c.instanceId)).toContain(smokeRingsId);
    expect(afterFetch.players[0].discardPile.map(c => c.instanceId)).not.toContain(glamdringId);
    expect(afterFetch.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(smokeRingsId);

    // Fetch sub-flow is cleared
    expect(afterFetch.pendingEffects).toHaveLength(0);
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

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);

    // Play Smoke Rings and resolve the chain into the fetch sub-flow
    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // Pass to skip fetch
    const afterPass = dispatch(afterPlay, { type: 'pass', player: PLAYER_1 });

    // Fetch sub-flow cleared, still in long-event phase
    expect(afterPass.phaseState.phase).toBe(Phase.LongEvent);
    expect(afterPass.pendingEffects).toHaveLength(0);

    // Sideboard unchanged
    expect(afterPass.players[0].sideboard).toHaveLength(1);

    // Smoke Rings moved from cardsInPlay to discard after pass
    expect(afterPass.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(smokeRingsId);
    expect(afterPass.players[0].discardPile.map(c => c.instanceId)).toContain(smokeRingsId);
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

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);

    // Play Smoke Rings and resolve the chain into the fetch sub-flow
    const next = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // No eligible cards: MORIA (site) doesn't match filter, Smoke Rings is in cardsInPlay
    const fetchActions = viableActions(next, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(0);

    // Pass is still available
    const passActions = viableActions(next, PLAYER_1, 'pass');
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

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const next = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // Once the chain has resolved and the fetch sub-flow is the active player's,
    // the opponent has no actions (the response window was during the chain).
    const opponentActions = computeLegalActions(next, PLAYER_2);
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

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const glamdringId = state.players[0].sideboard[0].instanceId;

    // Play Smoke Rings, resolve the chain, then fetch
    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));
    const afterFetch = dispatch(afterPlay, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: glamdringId,
      source: 'sideboard',
    });

    // Still in long-event phase, pass is available
    const passActions = viableActions(afterFetch, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);

    // Can pass to advance to M/H phase
    const afterPass = dispatch(afterFetch, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.phaseState.phase).toBe(Phase.MovementHazard);
  });
});
