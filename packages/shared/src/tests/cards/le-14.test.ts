/**
 * @module le-14.test
 *
 * Card test: Hador (le-14)
 * Type: minion-character (ringwraith alignment)
 *
 * Card text:
 *   "Unique. Can use sorcery."
 *
 * Printed stats (documented here, not asserted against the JSON): Dúnadan
 * warrior/sage, prowess 5, body 9, mind 6, direct influence 1, 2 MP,
 * homesite Dol Guldur.
 *
 * Engine support:
 * | # | Rule            | Status      | Notes                                                                 |
 * |---|-----------------|-------------|-----------------------------------------------------------------------|
 * | 1 | Unique          | IMPLEMENTED | `cardDef.unique` + `isUniqueCharacterInPlay` block a 2nd copy in play  |
 * | 2 | Can use sorcery | N/A         | No engine consumer: spell-casting is not gated by caster skill, so    |
 * |   |                 |             | every character may already play sorcery cards. Same treatment as the |
 * |   |                 |             | "Can use sorcery" line on le-52 / le-53 / le-58 (all certified).       |
 *
 * Hador has no stat-modifiers or activated abilities — the only mechanically
 * meaningful rule is uniqueness, which is exercised below by driving the
 * play-character legal-action computation.
 *
 * Fixture alignment: minion-character (ringwraith). Tests build state at
 * minion havens (Dol Guldur le-367, Minas Morgul le-390).
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, Phase,
  buildTestState, resetMint,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  findCharInstanceId, handCardId, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const HADOR = 'le-14' as CardDefinitionId;

const LAGDUF = 'le-18' as CardDefinitionId;         // minion warrior, mind 3
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven (Hador's homesite)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId;  // minion shadow-hold (site-deck filler)

describe('Hador (le-14)', () => {
  beforeEach(() => resetMint());

  test('is playable from hand at a haven when no copy is in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [HADOR], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const hadorHandId = handCardId(state, RESOURCE_PLAYER);
    const hadorPlays = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === hadorHandId);
    expect(hadorPlays.length).toBeGreaterThanOrEqual(1);
  });

  test('unique: a second copy cannot be played while one is already in play for the same player', () => {
    // Player 1 already has Hador in play (company at Dol Guldur) and a second
    // copy in hand. The uniqueness check must block the hand copy from
    // producing a viable play-character action.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [HADOR] }], hand: [HADOR], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const hadorInPlayId = findCharInstanceId(state, RESOURCE_PLAYER, HADOR);
    const hadorHandId = handCardId(state, RESOURCE_PLAYER);
    expect(hadorHandId).not.toBe(hadorInPlayId);

    const viable = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === hadorHandId);
    expect(viable).toHaveLength(0);

    const nonViable = nonViablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === hadorHandId);
    expect(nonViable.length).toBeGreaterThanOrEqual(1);
  });

  test('unique: a copy cannot be played while the opposing player already has Hador in play', () => {
    // Cross-player uniqueness: Hador in play on player 2's side blocks player 1
    // from playing their own hand copy.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [HADOR], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [HADOR] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const hadorHandId = handCardId(state, RESOURCE_PLAYER);
    const hadorOnOpponentId = findCharInstanceId(state, HAZARD_PLAYER, HADOR);
    expect(hadorHandId).not.toBe(hadorOnOpponentId);

    const viable = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === hadorHandId);
    expect(viable).toHaveLength(0);

    const nonViable = nonViablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === hadorHandId);
    expect(nonViable.length).toBeGreaterThanOrEqual(1);
  });
});
