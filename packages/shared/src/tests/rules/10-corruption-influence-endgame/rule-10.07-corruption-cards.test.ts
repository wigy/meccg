/**
 * @module rule-10.07-corruption-cards
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.07: Corruption Cards
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A "corruption card" is a card with the "corruption" keyword (i.e. not just any card that forces or modifies a corruption check).
 * Only one corruption card may be played on each character per turn.
 * A corruption card can only be played when doing so would initiate a new chain of effects.
 * Corruption cards that cannot be played on Dwarves also cannot be played on Orcs.
 */

import { describe, expect, test, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../../index.js';
import {
  ALONE_AND_UNADVISED,
  ARAGORN, LEGOLAS,
  buildTestState, dispatch,
  findCharInstanceId,
  MINAS_TIRITH, MORIA,
  LORIEN, RIVENDELL,
  makeMHState,
  Phase,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  resetMint,
  viableActions,
} from '../../test-helpers.js';

const LURE_OF_EXPEDIENCE = 'le-122' as CardDefinitionId;

describe('Rule 10.07 — Corruption Cards', () => {
  beforeEach(() => resetMint());

  test('first corruption card is playable on a character this turn', () => {
    // Rule 10.07: only one corruption card per character per turn — the first is always legal.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ALONE_AND_UNADVISED], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = { ...state, phaseState: makeMHState() };
    const aragornId = findCharInstanceId(mhState, RESOURCE_PLAYER, ARAGORN);

    const acts = viableActions(mhState, PLAYER_2, 'play-hazard');

    expect(acts.some(a => (a.action as { targetCharacterId?: string }).targetCharacterId === (aragornId as string))).toBe(true);
  });

  test('second corruption card on the same character in the same turn is not viable', () => {
    // Rule 10.07: only one corruption card may be played on each character per turn.
    // We simulate that ALONE_AND_UNADVISED was already played on Aragorn by populating
    // corruptionCardsPlayedPerChar in the phase state.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LURE_OF_EXPEDIENCE], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const mhState = {
      ...state,
      phaseState: makeMHState({
        corruptionCardsPlayedPerChar: { [aragornId as string]: true as const },
      }),
    };

    const acts = viableActions(mhState, PLAYER_2, 'play-hazard');

    expect(acts.some(a => (a.action as { targetCharacterId?: string }).targetCharacterId === (aragornId as string))).toBe(false);
  });

  test('after playing a corruption card via dispatch, a second is blocked on the same character', () => {
    // End-to-end: hazard player plays ALONE_AND_UNADVISED on Aragorn; then
    // LURE_OF_EXPEDIENCE (also a corruption card) is no longer viable on Aragorn.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ALONE_AND_UNADVISED, LURE_OF_EXPEDIENCE], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhGameState = { ...state, phaseState: makeMHState() };
    const aragornId = findCharInstanceId(mhGameState, RESOURCE_PLAYER, ARAGORN);
    const aloneId = mhGameState.players[1].hand[0].instanceId;

    const afterFirst = dispatch(mhGameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: aloneId,
      targetCompanyId: mhGameState.players[0].companies[0].id,
      targetCharacterId: aragornId,
    });

    const acts = viableActions(afterFirst, PLAYER_2, 'play-hazard');
    expect(acts.some(a => (a.action as { targetCharacterId?: string }).targetCharacterId === (aragornId as string))).toBe(false);
  });

  test('corruption card may still be played on a different character in the same turn', () => {
    // Rule 10.07: per-character restriction — a second character is still a valid target.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [LURE_OF_EXPEDIENCE], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const mhState = {
      ...state,
      phaseState: makeMHState({
        corruptionCardsPlayedPerChar: { [aragornId as string]: true as const },
      }),
    };

    const acts = viableActions(mhState, PLAYER_2, 'play-hazard');

    // Aragorn is blocked, Legolas is still a valid target
    expect(acts.some(a => (a.action as { targetCharacterId?: string }).targetCharacterId === (aragornId as string))).toBe(false);
    expect(acts.some(a => (a.action as { targetCharacterId?: string }).targetCharacterId === (legolasId as string))).toBe(true);
  });
});
