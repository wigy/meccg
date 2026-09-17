/**
 * @module le-331.test
 *
 * Card test: Palantír of Annúminas (le-331)
 * Type: minion-resource-item (greater, palantír), alignment ringwraith, unique.
 * Marshalling Points: 3. Corruption Points: 3.
 *
 * "Unique. Palantír. With its bearer able to use a Palantír, tap Palantír of
 *  Annúminas to take a sage only card from your play deck and/or discard
 *  pile into your hand. Reshuffle your play deck. Bearer then makes a
 *  corruption check."
 *
 * Effects & engine support:
 * | # | Rule                                         | Mechanism                                                                 |
 * |---|-----------------------------------------------|---------------------------------------------------------------------------|
 * | 1 | Tap: fetch a "sage only" card to hand         | grant-action annuminas-fetch-sage-only, when bearer.canUsePalantir →      |
 * |   | from play deck / discard pile, reshuffle,     | enqueue-pending-fetch fetchFrom [deck, discard-pile] → hand, fetchShuffle,|
 * |   | bearer makes a corruption check               | filter keywords $includes sage-only, postCorruptionCheck                 |
 *
 * This is the minion mirror of the identical hero card, Palantír of
 * Annúminas (tw-297, certified) — same action name, same `enqueue-pending-
 * fetch` apply, no site restriction on either copy. The `sage-only`
 * fetch-filter keyword and the whole `enqueue-pending-fetch` mechanism are
 * established precedent (Palantír of Amon Sûl tw-296, Palantír of Orthanc
 * le-334). Note the ability has no sage requirement on the bearer — "sage
 * only" restricts the cards fetched, not who may tap the Palantír.
 *
 * Fixtures are minion (LE) throughout: Calendal (le-4) natively "may tap to
 * use a Palantír he bears" (`can-use-palantir` play-flag), Luitprand (le-23)
 * is a minion scout with no such ability, and Focus Palantír (le-184) is the
 * minion "Align Palantír" equivalent, granting `can-use-palantir` to a
 * non-Ringwraith bearer without a native ability. All Thought Bent upon It
 * (le-163) and Black Rain (le-169) are "Sage only" resource events carrying
 * the `sage-only` fetch keyword.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  Phase, CardStatus, Alignment,
  CardDefinitionId,
  buildTestState, resetMint,
  viableActions, dispatch, makePlayDeck,
  findCharInstanceId,
} from '../test-helpers.js';
import type { ActivateGrantedAction, GameState } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const ANNUMINAS       = 'le-331' as CardDefinitionId;
const FOCUS_PALANTIR  = 'le-184' as CardDefinitionId; // grants can-use-palantir, no native ability of its own
const ALL_THOUGHT      = 'le-163' as CardDefinitionId; // "Sage only" resource event
const BLACK_RAIN       = 'le-169' as CardDefinitionId; // "Sage only" resource event
const CALENDAL         = 'le-4'   as CardDefinitionId; // minion sage, native can-use-palantir
const LUITPRAND        = 'le-23'  as CardDefinitionId; // minion scout, not a sage, no Palantír ability
const DOL_GULDUR       = 'le-367' as CardDefinitionId; // minion dark-hold
const MINAS_MORGUL     = 'le-390' as CardDefinitionId; // minion darkhaven

/** Minion organization-phase state; PLAYER_1's company bears Annúminas. */
function buildOrgState(opts: {
  bearer?: CardDefinitionId;
  bearerItems?: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{
          site: DOL_GULDUR,
          characters: [
            { defId: opts.bearer ?? CALENDAL, items: opts.bearerItems ?? [ANNUMINAS] },
          ],
        }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
        playDeck: opts.playDeck ?? makePlayDeck(),
        discardPile: opts.discardPile ?? [],
      },
      { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [] }], hand: [], siteDeck: [DOL_GULDUR] },
    ],
  });
}

/** All viable `activate-granted-action` actions carrying the given action id. */
function grantActions(state: GameState, actionId: string): ActivateGrantedAction[] {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === actionId);
}

describe('Palantír of Annúminas (le-331)', () => {
  beforeEach(() => resetMint());

  test('fetch grant-action is available when the bearer can use a Palantír', () => {
    const state = buildOrgState({});
    expect(grantActions(state, 'annuminas-fetch-sage-only').length).toBe(1);
  });

  test('fetch grant-action is NOT available when the bearer cannot use a Palantír', () => {
    const state = buildOrgState({ bearer: LUITPRAND });
    expect(grantActions(state, 'annuminas-fetch-sage-only').length).toBe(0);
  });

  test('a non-sage bearer may activate it once granted can-use-palantir — "sage only" restricts the fetched card, not the user', () => {
    // Focus Palantír grants can-use-palantir to a non-Ringwraith bearer with
    // no sage requirement of its own; Luitprand (not a sage) bears it plus
    // the Palantír.
    const state = buildOrgState({ bearer: LUITPRAND, bearerItems: [ANNUMINAS, FOCUS_PALANTIR] });
    expect(grantActions(state, 'annuminas-fetch-sage-only').length).toBe(1);
  });

  test('fetch grant-action is NOT available when the Palantír is already tapped', () => {
    const base = buildOrgState({});
    const bearerId = findCharInstanceId(base, RESOURCE_PLAYER, CALENDAL);
    const bearer = base.players[0].characters[bearerId];
    const tapped: GameState = {
      ...base,
      players: [
        {
          ...base.players[0],
          characters: {
            ...base.players[0].characters,
            [bearerId]: {
              ...bearer,
              items: bearer.items.map(i =>
                i.definitionId === ANNUMINAS ? { ...i, status: CardStatus.Tapped } : i),
            },
          },
        },
        base.players[1],
      ] as typeof base.players,
    };
    expect(grantActions(tapped, 'annuminas-fetch-sage-only').length).toBe(0);
  });

  test('activating taps the Palantír and offers only "sage only" cards from the play deck and discard pile', () => {
    const state = buildOrgState({
      playDeck: [ALL_THOUGHT, LUITPRAND],
      discardPile: [BLACK_RAIN],
    });
    const action = grantActions(state, 'annuminas-fetch-sage-only')[0];
    expect(action).toBeDefined();
    const afterActivation = dispatch(state, action);

    const bearerId = findCharInstanceId(afterActivation, RESOURCE_PLAYER, CALENDAL);
    expect(afterActivation.players[0].characters[bearerId].items[0].status).toBe(CardStatus.Tapped);

    expect(afterActivation.pendingEffects.length).toBe(1);
    expect(afterActivation.pendingEffects[0].effect.type).toBe('fetch-to-deck');

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    // Only the two "Sage only" cards qualify — Luitprand (a character card in
    // the deck) does not carry the sage-only keyword.
    expect(fetchActions.length).toBe(2);
  });

  test('fetching moves the chosen card to hand, reshuffles the play deck, and enqueues a corruption check', () => {
    const state = buildOrgState({
      playDeck: [ALL_THOUGHT],
      discardPile: [BLACK_RAIN],
    });
    const action = grantActions(state, 'annuminas-fetch-sage-only')[0];
    const afterActivation = dispatch(state, action);

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    const pickBlackRain = fetchActions.find(ea => {
      const a = ea.action as { cardInstanceId: string };
      const card = [...afterActivation.players[0].playDeck, ...afterActivation.players[0].discardPile]
        .find(c => c.instanceId === a.cardInstanceId);
      return card?.definitionId === BLACK_RAIN;
    })!;
    expect(pickBlackRain).toBeDefined();

    const afterFetch = dispatch(afterActivation, pickBlackRain.action);

    expect(afterFetch.players[0].hand.some(c => c.definitionId === BLACK_RAIN)).toBe(true);
    expect(afterFetch.players[0].discardPile.some(c => c.definitionId === BLACK_RAIN)).toBe(false);
    expect(afterFetch.pendingEffects.length).toBe(0);

    const pending = afterFetch.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });
});
