/**
 * @module rule-1.35-cards-vs-ringwraith
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.35: Cards Not Playable vs Ringwraith
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The following cards cannot be played against a Ringwraith opponent, and have no effect on Ringwraith players nor their entities if played by a Ringwraith player:
 * • Hazards that require an agent (as an active condition)
 * • Bane of the Ithil-stone
 * • The Black Enemy's Wrath
 * • Foul Fumes
 * • In the Heart of His Realm
 * • Mordor in Arms
 * • Mûmak
 * • Worn and Famished
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, Phase, computeLegalActions } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, resetMint, handCardId,
  viableActions, nonViableOfType,
  makeWildernessMHState,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN,
} from '../../test-helpers.js';

// dm-72 = Mordor in Arms — a hazard permanent-event with no play-target,
// so it is unconditionally offered as a viable play-hazard action once
// BANNED_VS_RINGWRAITH_OPPONENT is not blocking it.
const MORDOR_IN_ARMS = 'dm-72' as CardDefinitionId;

describe('Rule 1.35 — Cards Not Playable vs Ringwraith', () => {
  beforeEach(() => resetMint());

  test('a banned card is viable to play when the opponent is not a Ringwraith player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [MORDOR_IN_ARMS], siteDeck: [] },
      ],
    });
    const gameState = { ...state, phaseState: makeWildernessMHState() };
    const cardId = handCardId(gameState, HAZARD_PLAYER);

    const plays = viableActions(gameState, PLAYER_2, 'play-hazard');
    expect(plays.some(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === cardId)).toBe(true);
  });

  test('a banned card cannot be played when the opponent is a Ringwraith player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [MORDOR_IN_ARMS], siteDeck: [] },
      ],
    });
    const gameState = { ...state, phaseState: makeWildernessMHState() };
    const cardId = handCardId(gameState, HAZARD_PLAYER);
    const actions = computeLegalActions(gameState, PLAYER_2);

    // Never offered as a viable play-hazard action.
    const plays = viableActions(gameState, PLAYER_2, 'play-hazard');
    expect(plays.some(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === cardId)).toBe(false);

    // Reported to the UI as explicitly not-playable, naming the Ringwraith opponent.
    const notPlayable = nonViableOfType(actions, 'not-playable')
      .find(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === cardId);
    expect(notPlayable?.reason).toMatch(/Ringwraith/);
  });

  test.todo('Hazards that require an agent (as an active condition) cannot be played against a Ringwraith opponent');
});
