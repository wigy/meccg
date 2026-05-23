/**
 * @module tw-122.test
 *
 * Card test: Arwen (tw-122)
 * Type: hero-character
 * Prowess 2 / Body 8 / Mind 3 / DI 0 / MP 1
 * Race: elf
 * Skills: scout, sage
 * Homesite: Rivendell
 * Effects: 1 — stat-modifier direct-influence +7 vs Aragorn II (influence-check)
 *
 * "Unique. +7 direct influence only usable against Aragorn II."
 *
 * Engine Support:
 * | # | Feature                              | Status      | Notes                                        |
 * |---|--------------------------------------|-------------|----------------------------------------------|
 * | 1 | +7 DI vs Aragorn II (character)      | IMPLEMENTED | stat-modifier, reason=influence-check        |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  findCharInstanceId, getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';
import { availableDI } from '../../engine/legal-actions/organization.js';

const ARWEN = 'tw-122' as CardDefinitionId;

describe('Arwen (tw-122)', () => {
  beforeEach(() => resetMint());

  test('base effective DI is 0 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARWEN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const baseDef = pool[ARWEN as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(0);
    expect(getCharacter(state, RESOURCE_PLAYER, ARWEN).effectiveStats.directInfluence).toBe(0);
  });

  test('+7 DI bonus applies when checking influence against Aragorn II', () => {
    // Arwen base DI = 0. The +7 DI bonus against Aragorn II gives effective DI 7 against him.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARWEN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const arwenId = findCharInstanceId(state, RESOURCE_PLAYER, ARWEN);
    const aragornDef = pool[ARAGORN as string] as CharacterCard;

    // availableDI with Aragorn II as target should include the +7 bonus: 0 + 7 = 7
    const diAgainstAragorn = availableDI(state, arwenId, state.players[0], aragornDef);
    expect(diAgainstAragorn).toBe(7);
  });

  test('+7 DI bonus does NOT apply when checking influence against non-Aragorn II characters', () => {
    // Legolas is an elf but not Aragorn II, so the bonus does not apply.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARWEN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const arwenId = findCharInstanceId(state, RESOURCE_PLAYER, ARWEN);
    const legolasDef = pool[LEGOLAS as string] as CharacterCard;

    // availableDI without the bonus should be just base DI: 0
    const diAgainstLegolas = availableDI(state, arwenId, state.players[0], legolasDef);
    expect(diAgainstLegolas).toBe(0);
  });
});
