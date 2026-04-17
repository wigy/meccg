/**
 * @module dm-45.test
 *
 * Card test: An Unexpected Outpost (dm-45)
 * Type: hazard-event (short)
 * Effects: 2 (fetch-to-deck ×1 always, fetch-to-deck ×1 with Doors of Night)
 *
 * "Bring one hazard from your sideboard or discard pile into your play deck
 *  and shuffle. If Doors of Night is in play, you may do this twice."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, P1_COMPANY,
  ARAGORN,
  DOORS_OF_NIGHT, ORC_PATROL, CAVE_DRAKE, ORC_GUARD,
  resetMint,
  handCardId, dispatch, resolveChain, viableActions,
  CardStatus,
  actionAs, HAZARD_PLAYER,
  buildAnUnexpectedOutpostMH,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, PlayHazardAction, FetchFromPileAction } from '../../index.js';
import { Phase, computeLegalActions } from '../../index.js';

describe('An Unexpected Outpost (dm-45)', () => {
  beforeEach(() => resetMint());

  test('playable as hazard short-event during play-hazards', () => {
    const state = buildAnUnexpectedOutpostMH();
    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    const shortEventActions = actions.filter(ea => {
      const instId = actionAs<PlayHazardAction>(ea.action).cardInstanceId;
      const def = state.cardPool[instId as unknown as string]
        ?? state.cardPool[state.players[1].hand.find(c => c.instanceId === instId)?.definitionId as string];
      return def && 'eventType' in def && def.eventType === 'short';
    });
    expect(shortEventActions.length).toBeGreaterThanOrEqual(1);
  });

  test('playing the card enters chain, then resolves into fetch sub-flow', () => {
    const state = buildAnUnexpectedOutpostMH({ sideboard: [ORC_PATROL] });
    const cardId = handCardId(state, HAZARD_PLAYER);
    const companyId = P1_COMPANY;

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: companyId,
    });

    expect(afterPlay.chain).not.toBeNull();

    const afterChain = resolveChain(afterPlay);
    expect(afterChain.chain).toBeNull();

    expect(afterChain.pendingEffects).toHaveLength(1);
    expect(afterChain.pendingEffects[0].effect.type).toBe('fetch-to-deck');
    expect(afterChain.pendingEffects[0].actor).toBe(PLAYER_2);

    expect(afterChain.players[1].cardsInPlay.map(c => c.instanceId)).toContain(cardId);
  });

  test('fetch sub-flow shows eligible hazard cards from sideboard', () => {
    const state = buildAnUnexpectedOutpostMH({ sideboard: [ORC_PATROL, CAVE_DRAKE] });
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
    });
    const afterChain = resolveChain(afterPlay);

    const fetchActions = viableActions(afterChain, PLAYER_2, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(2);
    expect(fetchActions.every(ea => actionAs<FetchFromPileAction>(ea.action).source === 'sideboard')).toBe(true);
  });

  test('fetch sub-flow shows eligible hazard cards from discard pile', () => {
    const state = buildAnUnexpectedOutpostMH({ discardPile: [ORC_PATROL] });
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
    });
    const afterChain = resolveChain(afterPlay);

    const fetchActions = viableActions(afterChain, PLAYER_2, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);
    expect(actionAs<FetchFromPileAction>(fetchActions[0].action).source).toBe('discard-pile');
  });

  test('fetching a card adds it to play deck and discards event card', () => {
    const state = buildAnUnexpectedOutpostMH({ sideboard: [ORC_PATROL] });
    const cardId = handCardId(state, HAZARD_PLAYER);
    const orcPatrolId = state.players[1].sideboard[0].instanceId;
    const originalDeckSize = state.players[1].playDeck.length;

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
    });
    const afterChain = resolveChain(afterPlay);

    const afterFetch = dispatch(afterChain, {
      type: 'fetch-from-pile',
      player: PLAYER_2,
      cardInstanceId: orcPatrolId,
      source: 'sideboard',
    });

    expect(afterFetch.players[1].playDeck.length).toBe(originalDeckSize + 1);
    expect(afterFetch.players[1].playDeck.map(c => c.instanceId)).toContain(orcPatrolId);
    expect(afterFetch.players[1].sideboard).toHaveLength(0);

    expect(afterFetch.pendingEffects).toHaveLength(0);
    expect(afterFetch.players[1].cardsInPlay.map(c => c.instanceId)).not.toContain(cardId);
    expect(afterFetch.players[1].discardPile.map(c => c.instanceId)).toContain(cardId);
  });

  test('pass during fetch sub-flow skips the fetch', () => {
    const state = buildAnUnexpectedOutpostMH({ sideboard: [ORC_PATROL] });
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
    });
    const afterChain = resolveChain(afterPlay);
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_2 });

    expect(afterPass.pendingEffects).toHaveLength(0);
    expect(afterPass.players[1].sideboard).toHaveLength(1);
    expect(afterPass.players[1].cardsInPlay.map(c => c.instanceId)).not.toContain(cardId);
    expect(afterPass.players[1].discardPile.map(c => c.instanceId)).toContain(cardId);
  });

  test('non-hazard cards in sideboard are not eligible for fetch', () => {
    const state = buildAnUnexpectedOutpostMH({ sideboard: [ARAGORN] });
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
    });
    const afterChain = resolveChain(afterPlay);

    const fetchActions = viableActions(afterChain, PLAYER_2, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(0);

    const passActions = viableActions(afterChain, PLAYER_2, 'pass');
    expect(passActions).toHaveLength(1);
  });

  test('resource player has no actions during fetch sub-flow', () => {
    const state = buildAnUnexpectedOutpostMH({ sideboard: [ORC_PATROL] });
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
    });
    const afterChain = resolveChain(afterPlay);

    const p1Actions = computeLegalActions(afterChain, PLAYER_1);
    expect(p1Actions).toHaveLength(0);
  });

  test('with Doors of Night in play, queues two fetch effects', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
    const state = buildAnUnexpectedOutpostMH({
      sideboard: [ORC_PATROL, CAVE_DRAKE],
      p2CardsInPlay: [donInPlay],
    });
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
    });
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.pendingEffects).toHaveLength(2);
    expect(afterChain.pendingEffects[0].effect.type).toBe('fetch-to-deck');
    expect(afterChain.pendingEffects[1].effect.type).toBe('fetch-to-deck');
  });

  test('with Doors of Night, can fetch two cards sequentially', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
    const state = buildAnUnexpectedOutpostMH({
      sideboard: [ORC_PATROL, CAVE_DRAKE],
      p2CardsInPlay: [donInPlay],
    });
    const cardId = handCardId(state, HAZARD_PLAYER);
    const orcPatrolId = state.players[1].sideboard[0].instanceId;
    const caveDrakeId = state.players[1].sideboard[1].instanceId;
    const originalDeckSize = state.players[1].playDeck.length;

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
    });
    const afterChain = resolveChain(afterPlay);

    const afterFetch1 = dispatch(afterChain, {
      type: 'fetch-from-pile',
      player: PLAYER_2,
      cardInstanceId: orcPatrolId,
      source: 'sideboard',
    });

    expect(afterFetch1.pendingEffects).toHaveLength(1);
    expect(afterFetch1.players[1].cardsInPlay.map(c => c.instanceId)).toContain(cardId);

    const afterFetch2 = dispatch(afterFetch1, {
      type: 'fetch-from-pile',
      player: PLAYER_2,
      cardInstanceId: caveDrakeId,
      source: 'sideboard',
    });

    expect(afterFetch2.pendingEffects).toHaveLength(0);
    expect(afterFetch2.players[1].playDeck.length).toBe(originalDeckSize + 2);
    expect(afterFetch2.players[1].sideboard).toHaveLength(0);
    expect(afterFetch2.players[1].cardsInPlay.map(c => c.instanceId)).not.toContain(cardId);
    expect(afterFetch2.players[1].discardPile.map(c => c.instanceId)).toContain(cardId);
  });

  test('without Doors of Night, only one fetch effect is queued', () => {
    const state = buildAnUnexpectedOutpostMH({ sideboard: [ORC_PATROL, CAVE_DRAKE] });
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
    });
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.pendingEffects).toHaveLength(1);
  });

  test('after fetch completes, normal M/H actions resume', () => {
    const state = buildAnUnexpectedOutpostMH({ sideboard: [ORC_PATROL] });
    const cardId = handCardId(state, HAZARD_PLAYER);
    const orcPatrolId = state.players[1].sideboard[0].instanceId;

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
    });
    const afterChain = resolveChain(afterPlay);
    const afterFetch = dispatch(afterChain, {
      type: 'fetch-from-pile',
      player: PLAYER_2,
      cardInstanceId: orcPatrolId,
      source: 'sideboard',
    });

    expect(afterFetch.phaseState.phase).toBe(Phase.MovementHazard);
    const p2Actions = viableActions(afterFetch, PLAYER_2, 'pass');
    expect(p2Actions.length).toBeGreaterThanOrEqual(1);
  });

  test('can fetch from discard pile', () => {
    const state = buildAnUnexpectedOutpostMH({ discardPile: [ORC_GUARD] });
    const cardId = handCardId(state, HAZARD_PLAYER);
    const orcGuardId = state.players[1].discardPile[0].instanceId;
    const originalDeckSize = state.players[1].playDeck.length;

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: P1_COMPANY,
    });
    const afterChain = resolveChain(afterPlay);
    const afterFetch = dispatch(afterChain, {
      type: 'fetch-from-pile',
      player: PLAYER_2,
      cardInstanceId: orcGuardId,
      source: 'discard-pile',
    });

    expect(afterFetch.players[1].playDeck.length).toBe(originalDeckSize + 1);
    expect(afterFetch.players[1].playDeck.map(c => c.instanceId)).toContain(orcGuardId);
    expect(afterFetch.players[1].discardPile.map(c => c.instanceId)).not.toContain(orcGuardId);
  });
});
