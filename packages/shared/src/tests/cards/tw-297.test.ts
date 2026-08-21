/**
 * @module tw-297.test
 *
 * Card test: Palantír of Annúminas (tw-297)
 * Type: hero-resource-item (greater), alignment wizard, unique.
 * Marshalling Points: 3. Corruption Points: 2. Keywords: palantir.
 *
 * "Unique. Palantír. With its bearer able to use a Palantír, tap Palantír
 *  of Annúminas to search through your play deck and discard pile for a
 *  'sage only' card. Put this card in your hand. Reshuffle your play deck.
 *  Bearer makes a corruption check."
 *
 * Effects & engine support:
 * | # | Rule                                         | Mechanism                                                                 |
 * |---|-----------------------------------------------|---------------------------------------------------------------------------|
 * | 1 | Tap: fetch a "sage only" card to hand         | grant-action annuminas-fetch-sage-only, when bearer.canUsePalantir →       |
 * |   | from play deck / discard pile, reshuffle,     | enqueue-pending-fetch fetchFrom [deck, discard-pile] → hand, fetchShuffle, |
 * |   | bearer makes a corruption check               | filter keywords $includes sage-only, postCorruptionCheck                   |
 *
 * This is the card's own native ability; Palantír of Amon Sûl (tw-296,
 * certified) borrows the identical apply via its `amon-sul-use-annuminas`
 * grant-action, so the whole mechanism (`enqueue-pending-fetch` +
 * `sage-only` keyword tagging across the pool) is established precedent.
 * Note the ability has no sage requirement on the bearer — "sage only"
 * restricts the cards fetched, not who may tap the Palantír.
 *
 * Fixtures: Saruman (tw-181, Wizard/sage, native `can-use-palantir`) bears
 * Annúminas. Aragorn II (tw-120, non-sage, no Palantír use) proves the
 * `bearer.canUsePalantir` gate; adding Align Palantír (tw-190, a
 * `can-use-palantir` play-flag carrier) proves a non-sage bearer may still
 * activate the ability. Far-sight (tw-238) and Ringlore (tw-318) are "Sage
 * only" resource events carrying the `sage-only` fetch keyword.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  Phase, CardStatus,
  CardDefinitionId,
  buildTestState, resetMint,
  viableActions, dispatch, makePlayDeck,
  findCharInstanceId,
  ARAGORN, SARUMAN, RIVENDELL, MORIA,
} from '../test-helpers.js';
import type { ActivateGrantedAction, GameState } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const ANNUMINAS = 'tw-297' as CardDefinitionId;
const ALIGN_PALANTIR = 'tw-190' as CardDefinitionId; // grants can-use-palantir, no sage requirement of its own
const FAR_SIGHT = 'tw-238' as CardDefinitionId;       // "Sage only" resource event
const RINGLORE = 'tw-318' as CardDefinitionId;        // "Sage only" resource event
const LORIEN = 'tw-408' as CardDefinitionId;

/** Hero organization-phase state; PLAYER_1's company bears Annúminas. */
function buildOrgState(opts: {
  bearer?: CardDefinitionId;
  bearerItems?: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{
          site: MORIA,
          characters: [
            { defId: opts.bearer ?? SARUMAN, items: opts.bearerItems ?? [ANNUMINAS] },
          ],
        }],
        hand: [],
        siteDeck: [RIVENDELL],
        playDeck: opts.playDeck ?? makePlayDeck(),
        discardPile: opts.discardPile ?? [],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
    ],
  });
}

/** All viable `activate-granted-action` actions carrying the given action id. */
function grantActions(state: GameState, actionId: string): ActivateGrantedAction[] {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === actionId);
}

describe('Palantír of Annúminas (tw-297)', () => {
  beforeEach(() => resetMint());

  test('fetch grant-action is available when the bearer can use a Palantír', () => {
    const state = buildOrgState({});
    expect(grantActions(state, 'annuminas-fetch-sage-only').length).toBe(1);
  });

  test('fetch grant-action is NOT available when the bearer cannot use a Palantír', () => {
    const state = buildOrgState({ bearer: ARAGORN });
    expect(grantActions(state, 'annuminas-fetch-sage-only').length).toBe(0);
  });

  test('a non-sage bearer may activate it — "sage only" restricts the fetched card, not the user', () => {
    // Align Palantír grants can-use-palantir with no sage requirement of its
    // own; Aragorn (not a sage) bears it plus the Palantír.
    const state = buildOrgState({ bearer: ARAGORN, bearerItems: [ANNUMINAS, ALIGN_PALANTIR] });
    expect(grantActions(state, 'annuminas-fetch-sage-only').length).toBe(1);
  });

  test('fetch grant-action is NOT available when the Palantír is already tapped', () => {
    const base = buildOrgState({});
    const sarumanId = findCharInstanceId(base, RESOURCE_PLAYER, SARUMAN);
    const bearer = base.players[0].characters[sarumanId];
    const tapped: GameState = {
      ...base,
      players: [
        {
          ...base.players[0],
          characters: {
            ...base.players[0].characters,
            [sarumanId]: {
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
      playDeck: [FAR_SIGHT, ARAGORN],
      discardPile: [RINGLORE],
    });
    const action = grantActions(state, 'annuminas-fetch-sage-only')[0];
    expect(action).toBeDefined();
    const afterActivation = dispatch(state, action);

    const sarumanId = findCharInstanceId(afterActivation, RESOURCE_PLAYER, SARUMAN);
    expect(afterActivation.players[0].characters[sarumanId].items[0].status).toBe(CardStatus.Tapped);

    expect(afterActivation.pendingEffects.length).toBe(1);
    expect(afterActivation.pendingEffects[0].effect.type).toBe('fetch-to-deck');

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    // Only the two "Sage only" cards qualify — Aragorn (a character card in
    // the deck) does not carry the sage-only keyword.
    expect(fetchActions.length).toBe(2);
  });

  test('fetching moves the chosen card to hand, reshuffles the play deck, and enqueues a corruption check', () => {
    const state = buildOrgState({
      playDeck: [FAR_SIGHT],
      discardPile: [RINGLORE],
    });
    const action = grantActions(state, 'annuminas-fetch-sage-only')[0];
    const afterActivation = dispatch(state, action);

    const fetchActions = computeLegalActions(afterActivation, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    const pickRinglore = fetchActions.find(ea => {
      const a = ea.action as { cardInstanceId: string };
      const card = [...afterActivation.players[0].playDeck, ...afterActivation.players[0].discardPile]
        .find(c => c.instanceId === a.cardInstanceId);
      return card?.definitionId === RINGLORE;
    })!;
    expect(pickRinglore).toBeDefined();

    const afterFetch = dispatch(afterActivation, pickRinglore.action);

    expect(afterFetch.players[0].hand.some(c => c.definitionId === RINGLORE)).toBe(true);
    expect(afterFetch.players[0].discardPile.some(c => c.definitionId === RINGLORE)).toBe(false);
    expect(afterFetch.pendingEffects.length).toBe(0);

    const pending = afterFetch.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });
});
