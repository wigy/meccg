/**
 * @module le-38.test
 *
 * Card test: Radbug (le-38)
 * Type: minion-character
 *
 * "Unique. Uruk-hai. Discard on a body check result of 8."
 *
 * Card shape (unique, race orc, prowess 5, body 8, mind 4, DI 0, keyword
 * Uruk-hai, homesite "Any site in Imlad Morgul") is documented here rather
 * than asserted in tests — verifying JSON against itself proves nothing.
 * "Uruk-hai" is a descriptive keyword used by condition filters on other
 * cards; it carries no card-specific engine logic on Radbug itself.
 * "Discard on a body check result of 8" is the standard semantic of body 8
 * for Orc characters and needs no card-specific test beyond what the
 * general Orc body-check tests already cover.
 *
 * Rules tested:
 * 1. Unique: only one copy may be in play at a time (either player).
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion
 * sites (LE) and minion candidate characters (LE).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, Phase,
  buildTestState, resetMint,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  findCharInstanceId, handCardId, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const RADBUG = 'le-38' as CardDefinitionId;

const LAGDUF = 'le-18' as CardDefinitionId;         // minion warrior, mind 3
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId;  // minion shadow-hold

describe('Radbug (le-38)', () => {
  beforeEach(() => resetMint());

  test('is playable from hand at a haven when no copy is in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [RADBUG], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const radbugHandId = handCardId(state, RESOURCE_PLAYER);
    const actions = viablePlayCharacterActions(state, PLAYER_1);
    const radbugPlays = actions.filter(a => a.characterInstanceId === radbugHandId);
    expect(radbugPlays.length).toBeGreaterThanOrEqual(1);
  });

  test('unique: a second copy cannot be played while one is already in play for the same player', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [RADBUG] }], hand: [RADBUG], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const radbugInPlayId = findCharInstanceId(state, RESOURCE_PLAYER, RADBUG);
    const radbugHandId = handCardId(state, RESOURCE_PLAYER);
    expect(radbugHandId).not.toBe(radbugInPlayId);

    const viable = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === radbugHandId);
    expect(viable).toHaveLength(0);

    const nonViable = nonViablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === radbugHandId);
    expect(nonViable.length).toBeGreaterThanOrEqual(1);
  });

  test('unique: a copy cannot be played while the opposing player already has Radbug in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [RADBUG], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [RADBUG] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const radbugHandId = handCardId(state, RESOURCE_PLAYER);
    const radbugOnOpponentId = findCharInstanceId(state, HAZARD_PLAYER, RADBUG);
    expect(radbugHandId).not.toBe(radbugOnOpponentId);

    const viable = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === radbugHandId);
    expect(viable).toHaveLength(0);

    const nonViable = nonViablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === radbugHandId);
    expect(nonViable.length).toBeGreaterThanOrEqual(1);
  });
});
