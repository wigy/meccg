/**
 * @module le-334.test
 *
 * Card test: Palantír of Orthanc (le-334)
 * Type: minion-resource-item (special, palantír), alignment ringwraith, unique.
 * Marshalling Points: 3. Corruption Points: 3.
 *
 * "Unique. Palantír. Playable at Isengard. With its bearer able to use a
 *  Palantír and with at least 5 cards in your play deck, tap Palantír of
 *  Orthanc to choose one card from your discard pile to move to your play
 *  deck (reshuffle the play deck). Bearer then makes a corruption check.
 *  This item does not give MPs to a Fallen-wizard regardless of other cards
 *  in play."
 *
 * Effects & engine support:
 * | # | Rule                                                  | Mechanism                                                       |
 * |---|-------------------------------------------------------|----------------------------------------------------------------|
 * | 1 | Playable at Isengard                                  | item-play-site sites=["Isengard"]                              |
 * | 2 | Bearer able to use a Palantír + 5+ cards in play deck | grant-action when bearer.canUsePalantir && player.playDeckSize  |
 * | 3 | Tap item → move a discard-pile card to play deck      | grant-action cost { tap: "self" } + enqueue-pending-fetch       |
 * | 4 | reshuffle the play deck                               | enqueue-pending-fetch fetchShuffle:true                         |
 * | 5 | Bearer then makes a corruption check                 | enqueue-pending-fetch postCorruptionCheck:true                  |
 *
 * The "does not give MPs to a Fallen-wizard" line is the `fw-mp-none` marker
 * (added with Palantír of Elostirion le-332, which prints the same clause and
 * carries its coverage): a Fallen-wizard scores 0 MP for the item, ahead of the
 * MEWH §4 clamp, Saruman's `fw-mp-full (cards: items)` exemption and every MP override.
 * The hero twin tw-300 carries the same marker.
 *
 * This is the minion (Ringwraith) twin of Palantír of Orthanc (tw-300); the
 * rules and engine wiring are identical, only alignment/MP/CP differ.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  Phase, CardStatus, Alignment,
  CardDefinitionId,
  buildTestState, buildMinionSitePhaseState, resetMint,
  viableActions, dispatch, makePlayDeck,
  findCharInstanceId, MORIA, LORIEN,
} from '../test-helpers.js';
import type { ActivateGrantedAction, GameState } from '../../index.js';
import { computeLegalActions, ISENGARD } from '../../index.js';

const PALANTIR_OF_ORTHANC_LE = 'le-334' as CardDefinitionId;
const CALENDAL = 'le-4' as CardDefinitionId;       // minion sage, can use a Palantír
const LUITPRAND = 'le-23' as CardDefinitionId;     // minion man scout, cannot use a Palantír
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion dark-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion site (discard fixture)

/** Build a minion organization-phase state with Calendal bearing the Palantír. */
function buildOrgState(opts: {
  bearer?: CardDefinitionId;
  playDeck?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [{ defId: opts.bearer ?? CALENDAL, items: [PALANTIR_OF_ORTHANC_LE] }] }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
        playDeck: opts.playDeck ?? makePlayDeck(),
        discardPile: opts.discardPile ?? [MINAS_MORGUL],
      },
      { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [] }], hand: [], siteDeck: [MINAS_MORGUL] },
    ],
  });
}

describe('Palantír of Orthanc (le-334)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: item-play-site (playable at Isengard) ──

  test('playable at Isengard during the minion site phase', () => {
    const state = buildMinionSitePhaseState({
      site: ISENGARD,
      characters: [CALENDAL],
      hand: [PALANTIR_OF_ORTHANC_LE],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBe(1);
  });

  test('reducer attaches the item at Isengard and taps the site', () => {
    const state = buildMinionSitePhaseState({
      site: ISENGARD,
      characters: [CALENDAL],
      hand: [PALANTIR_OF_ORTHANC_LE],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBe(1);

    const next = dispatch(state, playActions[0].action);
    const char = Object.values(next.players[0].characters)[0];
    const palantir = char.items.find(i => i.definitionId === PALANTIR_OF_ORTHANC_LE);
    expect(palantir).toBeDefined();
  });

  test('NOT playable at Moria (wrong site)', () => {
    const state = buildMinionSitePhaseState({
      site: MORIA,
      characters: [CALENDAL],
      hand: [PALANTIR_OF_ORTHANC_LE],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBe(0);
  });

  test('NOT playable at Lórien (wrong site)', () => {
    const state = buildMinionSitePhaseState({
      site: LORIEN,
      characters: [CALENDAL],
      hand: [PALANTIR_OF_ORTHANC_LE],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBe(0);
  });

  // ── Effect 2/3: grant-action palantir-fetch-discard ──

  test('grant-action available when bearer can use a Palantír with 5+ cards in deck', () => {
    const state = buildOrgState({});
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard');
    expect(palantirActions.length).toBe(1);
  });

  test('grant-action NOT available when the item is tapped', () => {
    const state = buildOrgState({});
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, CALENDAL);
    const char = state.players[0].characters[charId];
    const tappedItem = { ...char.items[0], status: CardStatus.Tapped };
    const tappedState: GameState = {
      ...state,
      players: [
        { ...state.players[0], characters: { ...state.players[0].characters, [charId]: { ...char, items: [tappedItem] } } },
        state.players[1],
      ] as typeof state.players,
    };

    const actions = viableActions(tappedState, PLAYER_1, 'activate-granted-action');
    const palantirActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard');
    expect(palantirActions.length).toBe(0);
  });

  test('grant-action NOT available when bearer cannot use a Palantír', () => {
    const state = buildOrgState({ bearer: LUITPRAND });
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard');
    expect(palantirActions.length).toBe(0);
  });

  test('grant-action NOT available when play deck has fewer than 5 cards', () => {
    const state = buildOrgState({ playDeck: [MINAS_MORGUL, MINAS_MORGUL, MINAS_MORGUL] });
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard');
    expect(palantirActions.length).toBe(0);
  });

  test('activating taps the Palantír and enqueues a fetch from discard', () => {
    const state = buildOrgState({});
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirAction = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard')!;
    expect(palantirAction).toBeDefined();

    const next = dispatch(state, palantirAction.action);

    const char = Object.values(next.players[0].characters)[0];
    const palantir = char.items.find(i => i.definitionId === PALANTIR_OF_ORTHANC_LE);
    expect(palantir?.status).toBe(CardStatus.Tapped);

    expect(next.pendingEffects.length).toBe(1);
    expect(next.pendingEffects[0].type).toBe('card-effect');
    expect(next.pendingEffects[0].effect.type).toBe('fetch-to-deck');
  });

  test('fetch moves a card from discard to play deck, then bearer makes a corruption check', () => {
    const state = buildOrgState({});
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirAction = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard')!;
    const afterActivation = dispatch(state, palantirAction.action);

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions.length).toBeGreaterThan(0);

    const deckSizeBefore = afterActivation.players[0].playDeck.length;
    const discardSizeBefore = afterActivation.players[0].discardPile.length;
    const afterFetch = dispatch(afterActivation, fetchActions[0].action);

    // Card moved from discard to play deck (reshuffled in)
    expect(afterFetch.players[0].discardPile.length).toBe(discardSizeBefore - 1);
    expect(afterFetch.players[0].playDeck.length).toBe(deckSizeBefore + 1);

    // Pending fetch consumed
    expect(afterFetch.pendingEffects.length).toBe(0);

    // Bearer corruption check enqueued
    const pending = afterFetch.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });

  // ── Storing (CoE rule 2.II.4) ──

  test('storable at Dol Guldur (a Haven) despite being a special-subtype item', () => {
    // Bug report: a Ringwraith player could not store the Palantír at Dol
    // Guldur. Rule 2.II.4 places no subtype restriction on storing items at
    // a Haven — the only blanket exception is The One Ring (rule g.sto.1).
    const state = buildOrgState({});
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, CALENDAL);
    const palantirInstId = state.players[0].characters[charId].items[0].instanceId;

    const stores = viableActions(state, PLAYER_1, 'store-item');
    expect(stores.some(ea =>
      'itemInstanceId' in ea.action && ea.action.itemInstanceId === palantirInstId &&
      'characterId' in ea.action && ea.action.characterId === charId,
    )).toBe(true);
  });
});
