/**
 * @module tw-181.test
 *
 * Card test: Saruman (tw-181)
 * Type: hero-character (wizard)
 * Effects: 1 (grant-action saruman-fetch-spell)
 *
 * "Unique. May tap to use a Palantír he bears. At the beginning of your
 * end-of-turn phase, you may tap Saruman to take one spell card from
 * your discard pile to your hand."
 *
 * Tests:
 * 1. Palantír use: Saruman's text enables Palantír usage (detected by engine)
 * 2. Spell fetch: during end-of-turn discard step, Saruman can tap to take
 *    a spell card from discard pile to hand
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus,
  SARUMAN, ARAGORN,
  WIZARDS_LAUGHTER, VANISHMENT, GLAMDRING,
  PALANTIR_OF_ORTHANC,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, dispatch, makePlayDeck,
  getCharacter,
} from '../test-helpers.js';
import type { ActivateGrantedAction } from '../../index.js';

describe('Saruman (tw-181)', () => {
  beforeEach(() => resetMint());

  // ── Palantír use ───────────────────────────────────────────────────────


  test('Palantír of Orthanc grant-action is available when Saruman bears it', () => {
    const deckCards = makePlayDeck();
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: SARUMAN, items: [PALANTIR_OF_ORTHANC] }] }],
          hand: [],
          playDeck: deckCards,
          discardPile: [GLAMDRING],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard',
    );
    expect(palantirActions.length).toBe(1);
  });

  // ── Spell fetch (grant-action saruman-fetch-spell) ─────────────────────

  test('spell fetch action is available during end-of-turn discard step', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [SARUMAN] }],
          hand: [],
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const fetchActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'saruman-fetch-spell',
    );
    expect(fetchActions.length).toBe(1);
    expect((fetchActions[0].action as ActivateGrantedAction).targetCardId).toBeDefined();
  });

  test('spell fetch moves spell card from discard pile to hand and taps Saruman', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [SARUMAN] }],
          hand: [],
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const fetchAction = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'saruman-fetch-spell',
    )!;

    const newState = dispatch(state, fetchAction.action);

    // Spell card moved to hand
    expect(newState.players[0].hand.length).toBe(1);
    expect(newState.players[0].hand[0].definitionId).toBe(WIZARDS_LAUGHTER);

    // Spell card removed from discard
    expect(newState.players[0].discardPile.length).toBe(0);

    // Saruman is now tapped
    const saruman = getCharacter(newState, 0, SARUMAN);
    expect(saruman.status).toBe(CardStatus.Tapped);
  });

  test('spell fetch generates one action per spell card in discard', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [SARUMAN] }],
          hand: [],
          discardPile: [WIZARDS_LAUGHTER, VANISHMENT],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const fetchActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'saruman-fetch-spell',
    );
    expect(fetchActions.length).toBe(2);
  });

  test('spell fetch not available when Saruman is tapped', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: SARUMAN, status: CardStatus.Tapped }] }],
          hand: [],
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(0);
  });

  test('spell fetch not available when no spell cards in discard', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [SARUMAN] }],
          hand: [],
          discardPile: [GLAMDRING],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(0);
  });

  test('spell fetch not available for the hazard player', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [SARUMAN] }],
          hand: [],
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const actions = viableActions(state, PLAYER_2, 'activate-granted-action');
    expect(actions.length).toBe(0);
  });
});
