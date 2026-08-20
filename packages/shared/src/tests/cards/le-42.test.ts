/**
 * @module le-42.test
 *
 * Card test: Tarcil (le-42)
 * Type: minion-character
 * Skills: warrior, ranger, diplomat
 * Race: dunadan
 * Prowess 4 / Body 8 / Mind 6 / DI 2 / MP 2 (character)
 * Homesite: Minas Morgul
 * Effects: 0
 *
 * "Unique."
 *
 * No game effects beyond the uniqueness constraint, which is enforced by the
 * engine's isUniqueCharacterInPlay() check: a second copy cannot be brought
 * into play while one copy is already in any player's company.
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion sites
 * (LE) and minion candidate characters (LE).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const TARCIL = 'le-42' as CardDefinitionId;
const GRISHNAKH = 'le-12' as CardDefinitionId; // orc, minion character

// Minion sites
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven (Tarcil's homesite)
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold

describe('Tarcil (le-42)', () => {
  beforeEach(() => resetMint());

  test('playable at a haven when not already in play', () => {
    // Tarcil in hand, P1 company at Minas Morgul (a haven) — he should be
    // offered as a viable play-character action at that haven.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [GRISHNAKH] }],
          hand: [TARCIL],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const tarcilInstId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.some(a => a.characterInstanceId === tarcilInstId)).toBe(true);
  });

  test('blocked when already in play (uniqueness rule)', () => {
    // Tarcil already in P2's company; P1 has another copy in hand.
    // The engine must block the second play because Tarcil is unique.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [GRISHNAKH] }],
          hand: [TARCIL],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: BARAD_DUR, characters: [GRISHNAKH, TARCIL] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const tarcilInstId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.some(a => a.characterInstanceId === tarcilInstId)).toBe(false);

    const nonViable = nonViablePlayCharacterActions(state, PLAYER_1);
    expect(nonViable.some(a => a.characterInstanceId === tarcilInstId)).toBe(true);
  });
});
