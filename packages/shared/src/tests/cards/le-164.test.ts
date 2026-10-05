/**
 * @module le-164.test
 *
 * Card test: An Untimely Whisper (le-164)
 * Type: minion-resource-event (short), non-unique, Ringwraith. MP 0.
 *
 * Card text:
 *   "Opponent reveals to you 5 random cards at once from his hand."
 *
 * Effects (data):
 *   - on-event self-enters-play → peek-opponent-hand (count 5): on resolution
 *       min(5, opponent hand size) random opponent-hand instances are revealed
 *       to the card-player via `revealInstances`. The cards stay in the
 *       opponent's hand.
 *
 * Engine support:
 * | # | Rule                                                        | Status |
 * |---|-------------------------------------------------------------|--------|
 * | 1 | Playable as a resource short-event on the player's turn     | OK     |
 * | 2 | Opponent reveals 5 random hand cards (they stay in hand)   | OK     |
 * | 3 | With fewer than 5 cards, the whole hand is revealed        | OK     |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  CAVE_DRAKE, DOORS_OF_NIGHT,
  buildTestState, resetMint, Phase,
  findHandCardId, viableActions, dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction } from '../../index.js';

const AN_UNTIMELY_WHISPER = 'le-164' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const MORIA_LE = 'le-392' as CardDefinitionId;
const NON_ENV_HAZARD_A = 'as-23' as CardDefinitionId;
const NON_ENV_HAZARD_B = 'as-25' as CardDefinitionId;

function buildState(opponentHand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
        hand: [AN_UNTIMELY_WHISPER],
        siteDeck: [MORIA_LE],
      },
      {
        id: PLAYER_2,
        companies: [{ site: MINAS_MORGUL, characters: [] }],
        hand: opponentHand,
        siteDeck: [MORIA_LE],
      },
    ],
  });
}

function whisperPlays(state: GameState): PlayShortEventAction[] {
  const cardId = findHandCardId(state, RESOURCE_PLAYER, AN_UNTIMELY_WHISPER);
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(a => a.action as PlayShortEventAction)
    .filter(a => a.cardInstanceId === cardId);
}

function revealedOpponentHand(state: GameState): CardInstanceId[] {
  return state.players[HAZARD_PLAYER].hand
    .map(c => c.instanceId)
    .filter(id => state.revealedInstances[id] !== undefined);
}

describe('An Untimely Whisper (le-164)', () => {
  beforeEach(() => resetMint());

  test('is playable as a short-event during the organization phase', () => {
    const state = buildState([CAVE_DRAKE]);
    expect(whisperPlays(state)).toHaveLength(1);
  });

  test('opponent reveals exactly 5 random cards from a larger hand; they stay in hand', () => {
    const state = buildState([
      CAVE_DRAKE, DOORS_OF_NIGHT, NON_ENV_HAZARD_A, NON_ENV_HAZARD_B,
      CAVE_DRAKE, DOORS_OF_NIGHT, NON_ENV_HAZARD_A,
    ]);
    const oppHandIds = state.players[HAZARD_PLAYER].hand.map(c => c.instanceId);
    expect(revealedOpponentHand(state)).toHaveLength(0);

    const after = dispatch(state, whisperPlays(state)[0]);

    // All 7 cards remain in the opponent's hand; exactly 5 are revealed.
    expect(after.players[HAZARD_PLAYER].hand.map(c => c.instanceId)).toEqual(oppHandIds);
    expect(revealedOpponentHand(after)).toHaveLength(5);

    // The short-event is spent.
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === AN_UNTIMELY_WHISPER)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === AN_UNTIMELY_WHISPER)).toBe(true);
  });

  test('the revealed subset is random (depends on the game RNG)', () => {
    const hand = [
      CAVE_DRAKE, DOORS_OF_NIGHT, NON_ENV_HAZARD_A, NON_ENV_HAZARD_B,
      CAVE_DRAKE, DOORS_OF_NIGHT, NON_ENV_HAZARD_A, NON_ENV_HAZARD_B,
    ];
    const subsets = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      resetMint();
      const base = buildState(hand);
      const state = { ...base, rng: { ...base.rng, seed, counter: 0 } };
      const after = dispatch(state, whisperPlays(state)[0]);
      const revealed = revealedOpponentHand(after);
      expect(revealed).toHaveLength(5);
      subsets.add([...revealed].sort().join(','));
    }
    expect(subsets.size).toBeGreaterThan(1);
  });

  test('with fewer than 5 cards in hand, the opponent reveals the whole hand', () => {
    const state = buildState([CAVE_DRAKE, DOORS_OF_NIGHT, NON_ENV_HAZARD_A]);

    const after = dispatch(state, whisperPlays(state)[0]);

    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(3);
    expect(revealedOpponentHand(after)).toHaveLength(3);
  });
});
