/**
 * @module tw-334.test
 *
 * Card test: Stone of Erech (tw-334)
 * Type: hero-resource-event (permanent) · alignment: wizard · unique
 * Marshalling points: 2 (misc)
 *
 * Text:
 *   "Unique. Playable at the Vale of Erech and if the Men of Lamedon are
 *    already in play. Discard if the Men of Lamedon leave play."
 *
 * Effects:
 * | # | Effect Type                  | Notes                                             |
 * |---|-------------------------------|----------------------------------------------------|
 * | 1 | play-condition (card-in-play) | requires Men of Lamedon (tw-279) already in play   |
 * | 2 | play-target (site)            | only playable at Vale of Erech (tw-434)            |
 * | 3 | discard-on-card-leaves-play   | self-discard when Men of Lamedon leaves play       |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  resetMint, mint, pushCardInPlay,
  buildSitePhaseState, buildTestState,
  viableActions,
  ARAGORN, MORIA, LORIEN, LEGOLAS,
  CardStatus, Phase,
} from '../test-helpers.js';
import { applyDiscardOnCardLeaves } from '../../engine/discard-on-card-leaves.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState, PlayPermanentEventAction,
} from '../../index.js';

const STONE_OF_ERECH = 'tw-334' as CardDefinitionId;
const MEN_OF_LAMEDON = 'tw-279' as CardDefinitionId;
const VALE_OF_ERECH = 'tw-434' as CardDefinitionId;

const menOfLamedonCard = (instanceId: string): CardInPlay =>
  ({ instanceId: instanceId as CardInstanceId, definitionId: MEN_OF_LAMEDON, status: CardStatus.Untapped });

describe('Stone of Erech (tw-334)', () => {
  beforeEach(() => resetMint());

  // ── Effects 1+2: playable at Vale of Erech only if Men of Lamedon is in play ──

  test('IS playable at Vale of Erech when Men of Lamedon is already in play', () => {
    const base = buildSitePhaseState({
      site: VALE_OF_ERECH,
      characters: [ARAGORN],
      hand: [STONE_OF_ERECH],
    });
    const state = pushCardInPlay(base, 0, menOfLamedonCard('m1'));
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const act = actions[0].action as PlayPermanentEventAction;
    expect(act.targetSiteDefinitionId).toBe(VALE_OF_ERECH);
    expect(act.targetCharacterId).toBeUndefined();
  });

  test('NOT playable at Vale of Erech without Men of Lamedon in play', () => {
    const state = buildSitePhaseState({
      site: VALE_OF_ERECH,
      characters: [ARAGORN],
      hand: [STONE_OF_ERECH],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('NOT playable at the wrong site (Moria) even with Men of Lamedon in play', () => {
    const base = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [STONE_OF_ERECH],
    });
    const state = pushCardInPlay(base, 0, menOfLamedonCard('m1'));
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test("NOT satisfied by an opponent's copy of Men of Lamedon", () => {
    const base = buildSitePhaseState({
      site: VALE_OF_ERECH,
      characters: [ARAGORN],
      hand: [STONE_OF_ERECH],
    });
    const state = pushCardInPlay(base, 1, menOfLamedonCard('m1'));
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effect 3: discard-on-card-leaves-play ──

  test('is discarded when Men of Lamedon leaves play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const withStone = pushCardInPlay(
      base, 0, { instanceId: mint(), definitionId: STONE_OF_ERECH, status: CardStatus.Untapped },
    );
    const withCards = pushCardInPlay(withStone, 0, menOfLamedonCard('m1'));

    const p0 = withCards.players[RESOURCE_PLAYER];
    const lamedon = p0.cardsInPlay.find(c => c.definitionId === MEN_OF_LAMEDON)!;
    const next: GameState = {
      ...withCards,
      players: [
        { ...p0,
          cardsInPlay: p0.cardsInPlay.filter(c => c.instanceId !== lamedon.instanceId),
          discardPile: [...p0.discardPile, { instanceId: lamedon.instanceId, definitionId: MEN_OF_LAMEDON }] },
        withCards.players[1],
      ] as GameState['players'],
    };

    const after = applyDiscardOnCardLeaves(withCards, next);
    const ap0 = after.players[RESOURCE_PLAYER];
    expect(ap0.cardsInPlay.some(c => c.definitionId === STONE_OF_ERECH)).toBe(false);
    expect(ap0.discardPile.some(c => c.definitionId === STONE_OF_ERECH)).toBe(true);
  });

  test('stays in play while Men of Lamedon remains in play (nothing left)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const withStone = pushCardInPlay(
      base, 0, { instanceId: mint(), definitionId: STONE_OF_ERECH, status: CardStatus.Untapped },
    );
    const withCards = pushCardInPlay(withStone, 0, menOfLamedonCard('m1'));

    const after = applyDiscardOnCardLeaves(withCards, withCards);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === STONE_OF_ERECH)).toBe(true);
  });
});
