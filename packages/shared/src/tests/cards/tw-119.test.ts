/**
 * @module tw-119.test
 *
 * Card test: Annalena (tw-119)
 * Type: hero-character
 * Skills: scout, sage
 * Race: elf
 * Prowess 3 / Body 8 / Mind 3 / DI 0 / MP 1 (character)
 * Homesite: Edhellond
 * Effects: 0
 *
 * "Unique."
 *
 * No game effects beyond the uniqueness constraint, which is enforced by the
 * engine's isUniqueCharacterInPlay() check: a second copy cannot be brought
 * into play while one copy is already in any player's company.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN,
  buildTestState, resetMint,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const ANNALENA = 'tw-119' as CardDefinitionId;

describe('Annalena (tw-119)', () => {
  beforeEach(() => resetMint());

  test('playable at a haven when not already in play', () => {
    // Annalena in hand, P1 company at Rivendell (a haven) — she should be
    // offered as a viable play-character action at that haven.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [ANNALENA],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const annalenaInstId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.some(a => a.characterInstanceId === annalenaInstId)).toBe(true);
  });

  test('blocked when already in play (uniqueness rule)', () => {
    // Annalena already in P2's company; P1 has another copy in hand.
    // The engine must block the second play because Annalena is unique.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [ANNALENA],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS, ANNALENA] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const annalenaInstId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.some(a => a.characterInstanceId === annalenaInstId)).toBe(false);

    const nonViable = nonViablePlayCharacterActions(state, PLAYER_1);
    expect(nonViable.some(a => a.characterInstanceId === annalenaInstId)).toBe(true);
  });
});
