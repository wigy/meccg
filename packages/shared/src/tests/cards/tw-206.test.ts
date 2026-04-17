/**
 * @module tw-206.test
 *
 * Card test: Dagger of Westernesse (tw-206)
 * Type: hero-resource-item
 * Effects: 1
 *
 * "Weapon. +1 to prowess to a maximum of 8."
 *
 * This tests:
 * 1. stat-modifier: +1 prowess with max cap of 8
 *    - Character below cap gains +1
 *    - Character at cap is not modified beyond 8
 *    - Character one below cap reaches exactly 8
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, ELROND, GLORFINDEL_II, LEGOLAS,
  DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  Phase,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CharacterCard } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Dagger of Westernesse (tw-206)', () => {
  beforeEach(() => resetMint());

  test('prowess +1 when bearer prowess is below max (Aragorn, base 6 → 7)', () => {
    const raw = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = recomputeDerived(raw);

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.prowess).toBe(6);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(7);
  });

  test('prowess capped at 8 when bearer already at 8 (Glorfindel II, base 8 → 8)', () => {
    const raw = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: GLORFINDEL_II, items: [DAGGER_OF_WESTERNESSE] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = recomputeDerived(raw);

    const baseDef = pool[GLORFINDEL_II as string] as CharacterCard;
    expect(baseDef.prowess).toBe(8);
    expect(getCharacter(state, RESOURCE_PLAYER, GLORFINDEL_II).effectiveStats.prowess).toBe(8);
  });

  test('prowess reaches exactly 8 when bearer is one below cap (Elrond, base 7 → 8)', () => {
    const raw = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ELROND, items: [DAGGER_OF_WESTERNESSE] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = recomputeDerived(raw);

    const baseDef = pool[ELROND as string] as CharacterCard;
    expect(baseDef.prowess).toBe(7);
    expect(getCharacter(state, RESOURCE_PLAYER, ELROND).effectiveStats.prowess).toBe(8);
  });
});
