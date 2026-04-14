/**
 * @module tw-300.test
 *
 * Card test: Palantír of Orthanc (tw-300)
 * Type: hero-resource-item (special, palantír)
 * Effects: 2 (item-play-site, grant-action palantir-fetch-discard)
 *
 * "Unique. Palantír. Playable only at Isengard. With its bearer able to
 *  use a Palantír and with at least 5 cards in your play deck, tap
 *  Palantír of Orthanc to choose one card from your discard pile to
 *  place in your play deck (reshuffle the play deck). Bearer makes a
 *  corruption check. This item does not give MPs to a Fallen-wizard
 *  regardless of other cards in play."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus,
  SARUMAN, ARAGORN, LEGOLAS,
  PALANTIR_OF_ORTHANC,
  LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, buildSitePhaseState, resetMint,
  viableActions, dispatch, makePlayDeck,
} from '../test-helpers.js';
import type { ActivateGrantedAction, GameState } from '../../index.js';
import { computeLegalActions, ISENGARD } from '../../index.js';

describe('Palantír of Orthanc (tw-300)', () => {
  beforeEach(() => resetMint());

  // ── Card definition ──


  // ── Effect 1: item-play-site (playable only at Isengard) ──

  test('playable at Isengard during site phase', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [SARUMAN],
      hand: [PALANTIR_OF_ORTHANC],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBe(1);
  });

  test('reducer accepts special item play at matching item-play-site', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [SARUMAN],
      hand: [PALANTIR_OF_ORTHANC],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBe(1);

    const next = dispatch(state, playActions[0].action);
    const char = Object.values(next.players[0].characters)[0];
    const palantir = char.items.find(i => i.definitionId === PALANTIR_OF_ORTHANC);
    expect(palantir).toBeDefined();
    expect(char.status).toBe(CardStatus.Tapped);
  });

  test('NOT playable at Moria (wrong site)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [SARUMAN],
      hand: [PALANTIR_OF_ORTHANC],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBe(0);
  });

  test('NOT playable at Lórien (haven)', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [SARUMAN],
      hand: [PALANTIR_OF_ORTHANC],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBe(0);
  });

  // ── Effect 2: grant-action palantir-fetch-discard ──

  test('grant-action available when Saruman bears Palantír with 5+ cards in deck', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: SARUMAN, items: [PALANTIR_OF_ORTHANC] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          discardPile: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard');
    expect(palantirActions.length).toBe(1);
  });

  test('grant-action NOT available when item is tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: SARUMAN, items: [PALANTIR_OF_ORTHANC] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          discardPile: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    // Tap the palantir item
    const char = Object.values(state.players[0].characters)[0];
    const tappedItem = { ...char.items[0], status: CardStatus.Tapped };
    const updatedChar = { ...char, items: [tappedItem] };
    const updatedChars = { ...state.players[0].characters, [Object.keys(state.players[0].characters)[0]]: updatedChar };
    const tappedState: GameState = {
      ...state,
      players: [
        { ...state.players[0], characters: updatedChars },
        state.players[1],
      ] as typeof state.players,
    };

    const actions = viableActions(tappedState, PLAYER_1, 'activate-granted-action');
    const palantirActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard');
    expect(palantirActions.length).toBe(0);
  });

  test('grant-action NOT available when bearer cannot use Palantír', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: ARAGORN, items: [PALANTIR_OF_ORTHANC] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          discardPile: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard');
    expect(palantirActions.length).toBe(0);
  });

  test('grant-action NOT available when play deck has fewer than 5 cards', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: SARUMAN, items: [PALANTIR_OF_ORTHANC] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [MORIA, MORIA, MORIA],
          discardPile: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard');
    expect(palantirActions.length).toBe(0);
  });

  test('activating grant-action taps Palantír and enqueues fetch from discard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: SARUMAN, items: [PALANTIR_OF_ORTHANC] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          discardPile: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirAction = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard')!;
    expect(palantirAction).toBeDefined();

    const next = dispatch(state, palantirAction.action);

    // Palantír should be tapped
    const char = Object.values(next.players[0].characters)[0];
    const palantir = char.items.find(i => i.definitionId === PALANTIR_OF_ORTHANC);
    expect(palantir?.status).toBe(CardStatus.Tapped);

    // Should have a pending fetch-to-deck effect
    expect(next.pendingEffects.length).toBe(1);
    expect(next.pendingEffects[0].type).toBe('card-effect');
    expect(next.pendingEffects[0].effect.type).toBe('fetch-to-deck');
  });

  test('after activation, player can fetch a card from discard pile', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: SARUMAN, items: [PALANTIR_OF_ORTHANC] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          discardPile: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    // Activate the palantir
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirAction = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard')!;
    const afterActivation = dispatch(state, palantirAction.action);

    // Should see fetch-from-pile actions
    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions.length).toBeGreaterThan(0);

    // Execute fetch
    const deckSizeBefore = afterActivation.players[0].playDeck.length;
    const discardSizeBefore = afterActivation.players[0].discardPile.length;
    const afterFetch = dispatch(afterActivation, fetchActions[0].action);

    // Card moved from discard to play deck
    expect(afterFetch.players[0].discardPile.length).toBe(discardSizeBefore - 1);
    expect(afterFetch.players[0].playDeck.length).toBe(deckSizeBefore + 1);

    // Pending effects consumed
    expect(afterFetch.pendingEffects.length).toBe(0);

    // Corruption check pending
    const pending = afterFetch.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });
});
