/**
 * @module tw-136.test
 *
 * Card test: Celeborn (tw-136)
 * Type: hero-character
 * Effects: 1
 *
 * "Unique. +5 direct influence that is only usable against Galadriel."
 *
 * This tests the single effect:
 * 1. stat-modifier: +5 DI during influence-check when target is Galadriel
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, CELEBORN, GALADRIEL, LEGOLAS, BEREGOND,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  findCharInstanceId, viablePlayCharacterActions,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CharacterCard } from '../../index.js';
import { availableDI } from '../../engine/legal-actions/organization.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Celeborn (tw-136)', () => {
  beforeEach(() => resetMint());

  test('base effective DI is 1 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [CELEBORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const baseDef = pool[CELEBORN as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(1);
    expect(getCharacter(state, RESOURCE_PLAYER, CELEBORN).effectiveStats.directInfluence).toBe(baseDef.directInfluence);
  });

  test('+5 DI bonus applies when checking influence against Galadriel', () => {
    // Celeborn base DI = 1. Galadriel is an elf with mind 9.
    // The +5 DI bonus against Galadriel gives Celeborn effective DI 6 against her.
    // While 6 < 9 means he can't control her as a follower, the bonus IS computed.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [CELEBORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const celebornId = findCharInstanceId(state, RESOURCE_PLAYER, CELEBORN);
    const galadrielDef = pool[GALADRIEL as string] as CharacterCard;

    // availableDI with Galadriel as target should include the +5 bonus: 1 + 5 = 6
    const diAgainstGaladriel = availableDI(state, celebornId, state.players[0], galadrielDef);
    expect(diAgainstGaladriel).toBe(6);
  });

  test('+5 DI bonus does NOT apply when checking influence against non-Galadriel characters', () => {
    // Legolas is an elf but not Galadriel, so the bonus does not apply.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [CELEBORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const celebornId = findCharInstanceId(state, RESOURCE_PLAYER, CELEBORN);
    const legolasDef = pool[LEGOLAS as string] as CharacterCard;

    // availableDI without the bonus should be just base DI: 1
    const diAgainstLegolas = availableDI(state, celebornId, state.players[0], legolasDef);
    expect(diAgainstLegolas).toBe(1);
  });

  test('Celeborn cannot control a non-Galadriel character with mind 2 (bonus does not apply)', () => {
    // Beregond is a dunadan with mind 2. Celeborn has base DI 1.
    // The +5 DI bonus only applies to Galadriel, so DI stays 1 < mind 2.
    // Celeborn cannot control Beregond as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [CELEBORN] }],
          hand: [BEREGOND],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const celebornId = findCharInstanceId(state, RESOURCE_PLAYER, CELEBORN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    // No DI bonus for non-Galadriel, so Celeborn cannot control Beregond as follower
    const beregondUnderCeleborn = actions.filter(
      a => a.controlledBy === celebornId,
    );
    expect(beregondUnderCeleborn).toHaveLength(0);
  });
});
