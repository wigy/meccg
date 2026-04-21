/**
 * @module le-36.test
 *
 * Card test: Ostisen (le-36)
 * Type: minion-character
 *
 * "Unique."
 *
 * Ostisen has no special abilities — just the standard "Unique" tag. His
 * printed stats (scout, mind 2, prowess 3, body 9, DI 0, homesite "Vale of
 * Erech") are documented by the card data; tests exercise the only rule
 * the card text defines: only one copy of Ostisen may be in play at a time
 * across all players.
 *
 * Fixture alignment: minion-character (ringwraith). Tests build state at
 * minion havens (Dol Guldur le-367, Minas Morgul le-390).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, Phase,
  buildTestState, resetMint,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  findCharInstanceId, handCardId, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const OSTISEN = 'le-36' as CardDefinitionId;

const LAGDUF = 'le-18' as CardDefinitionId;         // minion warrior, mind 3
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId;  // minion shadow-hold

describe('Ostisen (le-36)', () => {
  beforeEach(() => resetMint());

  test('is playable from hand at a haven when no copy is in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [OSTISEN], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const ostisenHandId = handCardId(state, RESOURCE_PLAYER);
    const actions = viablePlayCharacterActions(state, PLAYER_1);
    const ostisenPlays = actions.filter(a => a.characterInstanceId === ostisenHandId);
    expect(ostisenPlays.length).toBeGreaterThanOrEqual(1);
  });

  test('unique: a second copy cannot be played while one is already in play for the same player', () => {
    // Player 1 has one Ostisen already in play (in their company at Dol
    // Guldur) and a second copy in hand. The uniqueness check must block
    // the hand copy from producing a viable play-character action.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [OSTISEN] }], hand: [OSTISEN], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const ostisenInPlayId = findCharInstanceId(state, RESOURCE_PLAYER, OSTISEN);
    const ostisenHandId = handCardId(state, RESOURCE_PLAYER);
    expect(ostisenHandId).not.toBe(ostisenInPlayId);

    const viable = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === ostisenHandId);
    expect(viable).toHaveLength(0);

    const nonViable = nonViablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === ostisenHandId);
    expect(nonViable.length).toBeGreaterThanOrEqual(1);
  });

  test('unique: a copy cannot be played while the opposing player already has Ostisen in play', () => {
    // Cross-player uniqueness: Ostisen in play on player 2's side blocks
    // player 1 from playing their own hand copy.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [OSTISEN], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const ostisenHandId = handCardId(state, RESOURCE_PLAYER);
    const ostisenOnOpponentId = findCharInstanceId(state, HAZARD_PLAYER, OSTISEN);
    expect(ostisenHandId).not.toBe(ostisenOnOpponentId);

    const viable = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === ostisenHandId);
    expect(viable).toHaveLength(0);

    const nonViable = nonViablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === ostisenHandId);
    expect(nonViable.length).toBeGreaterThanOrEqual(1);
  });
});
