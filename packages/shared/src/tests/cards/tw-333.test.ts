/**
 * @module tw-333.test
 *
 * Card test: Sting (tw-333)
 * Type: hero-resource-item (minor item, weapon), unique
 *
 * "Unique. Weapon. +1 to prowess to a maximum of 8, +2 to a Hobbit's prowess
 *  to a maximum of 8."
 *
 * Engine Support:
 * | # | Feature                                   | Status      | Notes                                            |
 * |---|-------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | +1 prowess (cap 8) for any bearer         | IMPLEMENTED | stat-modifier id=sting-prowess, max 8            |
 * | 2 | +2 prowess (cap 8) for a Hobbit bearer    | IMPLEMENTED | stat-modifier overrides=sting-prowess, when race |
 *
 * The Hobbit clause is an `overrides` of the base +1, so a Hobbit gets +2
 * (not +3): the override replaces the base modifier rather than stacking.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  getCharacter, pool,
} from '../test-helpers.js';
import {
  ARAGORN, LEGOLAS, FRODO, GLORFINDEL_II, STING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../index.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';

/** Build an org-phase state with `bearer` holding Sting in P1's company. */
function stateWithSting(bearer: CardDefinitionId) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: bearer, items: [STING] }] }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

describe('Sting (tw-333)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 prowess (max 8) ──

  test('prowess +1 (max 8)', () => {
    // Aragorn (non-Hobbit, base prowess 6) → 6 + 1 = 7, well under the cap.
    const aragornDef = pool[ARAGORN as string] as CharacterCard;
    const state = stateWithSting(ARAGORN);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess)
      .toBe(aragornDef.prowess + 1);
    expect(aragornDef.prowess).toBe(6);
  });

  test('+1 prowess is capped at 8 (Glorfindel II, base prowess 8, does not reach 9)', () => {
    // Glorfindel II base prowess 8 → 8 + 1 = 9, clamped to the maximum of 8.
    const glorfindelDef = pool[GLORFINDEL_II as string] as CharacterCard;
    expect(glorfindelDef.prowess).toBe(8);
    const state = stateWithSting(GLORFINDEL_II);
    expect(getCharacter(state, RESOURCE_PLAYER, GLORFINDEL_II).effectiveStats.prowess).toBe(8);
  });

  // ── Effect 2: +2 to a Hobbit's prowess (max 8), overriding the +1 ──

  test('prowess +2 if bearer is hobbit (max 8) [overrides sting-prowess]', () => {
    // Frodo (Hobbit, base prowess 1) → 1 + 2 = 3. The Hobbit clause *overrides*
    // the base +1, so the result is +2 (not +1 and +2 stacked = +3).
    const frodoDef = pool[FRODO as string] as CharacterCard;
    expect(frodoDef.race).toBe('hobbit');
    const state = stateWithSting(FRODO);
    expect(getCharacter(state, RESOURCE_PLAYER, FRODO).effectiveStats.prowess)
      .toBe(frodoDef.prowess + 2);
  });
});
