/**
 * @module tw-289.test
 *
 * Card test: Narsil (tw-289)
 * Type: hero-resource-item (greater, weapon)
 * Effects: 2
 * Corruption points: 2
 *
 * "Unique. Weapon. +1 to prowess and direct influence."
 *
 * This tests:
 * 1. stat-modifier: prowess +1 (unconditional)
 * 2. stat-modifier: direct-influence +1 (unconditional)
 * 3. corruption points: 2 (structural field)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, FRODO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase,
  buildTestState, resetMint, dispatch, getCharacter,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';

const NARSIL = 'tw-289' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Narsil (tw-289)', () => {
  beforeEach(() => resetMint());

  test('prowess +1 for Aragorn (base 6 → 7)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [NARSIL] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.prowess).toBe(6);
    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(7);
  });

  test('prowess +1 for Frodo (base 1 → 2)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: FRODO, items: [NARSIL] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[FRODO as string] as CharacterCard;
    expect(baseDef.prowess).toBe(1);
    expect(getCharacter(s, RESOURCE_PLAYER, FRODO).effectiveStats.prowess).toBe(2);
  });

  test('direct influence +1 for Aragorn (base 3 → 4)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [NARSIL] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(3);
    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).effectiveStats.directInfluence).toBe(4);
  });

  test('direct influence +1 for Frodo (base 1 → 2)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: FRODO, items: [NARSIL] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[FRODO as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(1);
    expect(getCharacter(s, RESOURCE_PLAYER, FRODO).effectiveStats.directInfluence).toBe(2);
  });

  test('body is not modified by Narsil', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [NARSIL] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(baseDef.body);
  });

  test('corruption points 2 for the bearer', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [NARSIL] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // Aragorn base corruption 0; Narsil adds 2 corruption points
    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(2);
  });
});
