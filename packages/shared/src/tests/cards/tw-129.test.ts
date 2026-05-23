/**
 * @module tw-129.test
 *
 * Card test: Bergil (tw-129)
 * Type: hero-character
 * Prowess 1 / Body 9 / Mind 2 / DI 0 / MP 0
 * Race: dúnadan
 * Skills: warrior, scout
 * Homesite: Minas Tirith
 *
 * "Unique."
 *
 * Engine Support:
 * | # | Feature           | Status      | Notes                             |
 * |---|-------------------|-------------|-----------------------------------|
 * | 1 | Unique constraint | IMPLEMENTED | unique: true, enforced by reducer |
 *
 * Playable: YES
 * Certified: 2026-05-23
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MINAS_TIRITH, LORIEN, MORIA,
  buildTestState, resetMint,
  findHandCardId,
  viablePlayCharacterActions,
  nonViablePlayCharacterActions,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const BERGIL = 'tw-129' as CardDefinitionId;

describe('Bergil (tw-129)', () => {
  beforeEach(() => resetMint());

  test('Bergil can be played from hand when no duplicate is in play', () => {
    // Bergil (mind 2) is in P1's hand. Aragorn (DI 5) leads the company at
    // Minas Tirith (Bergil's homesite). Bergil should appear as a viable
    // play-character action.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [BERGIL],
          siteDeck: [MORIA],
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
      recompute: true,
    });

    const bergilHandId = findHandCardId(state, RESOURCE_PLAYER, BERGIL);
    const playable = viablePlayCharacterActions(state, PLAYER_1);

    expect(playable.some(a => a.characterInstanceId === bergilHandId)).toBe(true);
  });

  test('Bergil cannot be played when a copy is already in play for the same player', () => {
    // One Bergil is already in P1's company; a second copy is in hand.
    // The uniqueness rule (unique: true) must block the second copy.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [BERGIL],
          siteDeck: [MORIA],
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN, BERGIL] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
      recompute: true,
    });

    const bergilHandId = findHandCardId(state, RESOURCE_PLAYER, BERGIL);
    const playable = viablePlayCharacterActions(state, PLAYER_1);
    const blocked = nonViablePlayCharacterActions(state, PLAYER_1);

    expect(playable.some(a => a.characterInstanceId === bergilHandId)).toBe(false);
    expect(blocked.some(a => a.characterInstanceId === bergilHandId)).toBe(true);
  });

  test('Bergil cannot be played when a copy is already in play for the opponent', () => {
    // Bergil is in P2's company and in P1's hand.
    // Uniqueness is game-wide — P1 cannot play the second copy either.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [BERGIL],
          siteDeck: [MORIA],
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS, BERGIL] }],
        },
      ],
      recompute: true,
    });

    const bergilHandId = findHandCardId(state, RESOURCE_PLAYER, BERGIL);
    const playable = viablePlayCharacterActions(state, PLAYER_1);
    const blocked = nonViablePlayCharacterActions(state, PLAYER_1);

    expect(playable.some(a => a.characterInstanceId === bergilHandId)).toBe(false);
    expect(blocked.some(a => a.characterInstanceId === bergilHandId)).toBe(true);
  });
});
