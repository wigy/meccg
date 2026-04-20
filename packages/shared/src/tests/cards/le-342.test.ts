/**
 * @module le-342.test
 *
 * Card test: Saw-toothed Blade (le-342)
 * Type: minion-resource-item (minor, weapon)
 * Corruption: 1, Marshalling Points: 0
 *
 * "Weapon. +1 to prowess to a maximum of 8."
 *
 * Engine Support:
 * | # | Feature                                   | Status      | Notes                                      |
 * |---|-------------------------------------------|-------------|--------------------------------------------|
 * | 1 | +1 prowess, max 8                         | IMPLEMENTED | stat-modifier with max cap                 |
 *
 * Fixture alignment: minion-resource-item (ringwraith), so tests use
 * minion characters and sites (LE set).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  attachItemToChar,
  charIdAt, pool, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';

const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;

// Minion fixtures — declared locally per CLAUDE.md card-ids policy.
const GORBAG = 'le-11' as CardDefinitionId;                // prowess 6
const LIEUTENANT_OF_DOL_GULDUR = 'le-21' as CardDefinitionId; // prowess 7
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId;  // prowess 8
const SHAGRAT = 'le-39' as CardDefinitionId;                // prowess 6
const DOL_GULDUR = 'le-367' as CardDefinitionId;            // haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;          // haven
const MORIA = 'le-392' as CardDefinitionId;                 // shadow-hold
const BARAD_DUR = 'le-352' as CardDefinitionId;             // dark-hold

describe('Saw-toothed Blade (le-342)', () => {
  beforeEach(() => resetMint());

  test('prowess +1 when bearer is below cap (Gorbag, base 6 → 7)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const gorbagId = charIdAt(base, RESOURCE_PLAYER);
    const gorbagDef = pool[GORBAG as string] as CharacterCard;
    expect(gorbagDef.prowess).toBe(6);
    expect(base.players[0].characters[gorbagId as string].effectiveStats.prowess).toBe(6);

    const withBlade = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GORBAG, SAW_TOOTHED_BLADE));
    expect(withBlade.players[0].characters[gorbagId as string].effectiveStats.prowess).toBe(7);
  });

  test('prowess reaches exactly 8 when bearer is one below cap (Lt of Dol Guldur, base 7 → 8)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LIEUTENANT_OF_DOL_GULDUR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const charId = charIdAt(base, RESOURCE_PLAYER);
    const charDef = pool[LIEUTENANT_OF_DOL_GULDUR as string] as CharacterCard;
    expect(charDef.prowess).toBe(7);

    const withBlade = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, LIEUTENANT_OF_DOL_GULDUR, SAW_TOOTHED_BLADE));
    expect(withBlade.players[0].characters[charId as string].effectiveStats.prowess).toBe(8);
  });

  test('prowess capped at 8 when bearer already at 8 (Lt of Morgul, base 8 → 8)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LIEUTENANT_OF_MORGUL] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const charId = charIdAt(base, RESOURCE_PLAYER);
    const charDef = pool[LIEUTENANT_OF_MORGUL as string] as CharacterCard;
    expect(charDef.prowess).toBe(8);

    const withBlade = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL, SAW_TOOTHED_BLADE));
    expect(withBlade.players[0].characters[charId as string].effectiveStats.prowess).toBe(8);
  });

});
