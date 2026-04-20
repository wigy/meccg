/**
 * @module le-299.test
 *
 * Card test: Black Mace (le-299)
 * Type: minion-resource-item (greater, weapon)
 * Corruption: 3, Marshalling Points: 2
 *
 * "Weapon. Warrior only: +3 prowess to a maximum of 10 (+4 to a
 *  maximum of 10 against Elves)."
 *
 * Engine Support:
 * | # | Feature                                   | Status      | Notes                                      |
 * |---|-------------------------------------------|-------------|--------------------------------------------|
 * | 1 | +3 prowess, max 10 (Warrior only)         | IMPLEMENTED | stat-modifier with bearer.skills filter    |
 * | 2 | +4 prowess, max 10, vs Elves (override)   | IMPLEMENTED | stat-modifier override with combat/elf     |
 * | 3 | Non-warrior gets no bonus                 | IMPLEMENTED | bearer.skills $includes warrior on both    |
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
import { computeCombatProwess, recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';

const BLACK_MACE = 'le-299' as CardDefinitionId;

// Minion fixtures — declared locally per CLAUDE.md card-ids policy.
const GORBAG = 'le-11' as CardDefinitionId;            // warrior/scout, prowess 6
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId; // warrior/ranger, prowess 8
const LAYOS = 'le-19' as CardDefinitionId;             // sage/diplomat, prowess 3 (non-warrior)
const SHAGRAT = 'le-39' as CardDefinitionId;           // warrior/ranger, prowess 6
const DOL_GULDUR = 'le-367' as CardDefinitionId;       // haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;     // haven
const MORIA = 'le-392' as CardDefinitionId;            // shadow-hold
const BARAD_DUR = 'le-352' as CardDefinitionId;        // dark-hold

describe('Black Mace (le-299)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +3 prowess to warrior bearer, max 10 ─────────────────────

  test('warrior bearer gains +3 prowess from Black Mace in effective stats', () => {
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
    expect(base.players[0].characters[gorbagId as string].effectiveStats.prowess).toBe(gorbagDef.prowess);

    const withMace = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BLACK_MACE));
    expect(withMace.players[0].characters[gorbagId as string].effectiveStats.prowess)
      .toBe(gorbagDef.prowess + 3);
  });

  test('prowess bonus capped at 10 (Lieutenant of Morgul base 8)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LIEUTENANT_OF_MORGUL] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const lotId = charIdAt(base, RESOURCE_PLAYER);
    const lotDef = pool[LIEUTENANT_OF_MORGUL as string] as CharacterCard;
    expect(lotDef.prowess).toBe(8);

    const withMace = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL, BLACK_MACE));
    // 8 + 3 = 11, capped at 10
    expect(withMace.players[0].characters[lotId as string].effectiveStats.prowess).toBe(10);
  });

  // ── Effect 2: +4 prowess, max 10, vs Elves in combat (override) ────────

  test('warrior gets +4 prowess vs elf enemy in combat (override replaces base)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const withMace = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BLACK_MACE);
    const gorbagId = charIdAt(withMace, RESOURCE_PLAYER);
    const gorbag = withMace.players[0].characters[gorbagId as string];
    const gorbagDef = pool[GORBAG as string] as CharacterCard;

    const combatProwessVsElf = computeCombatProwess(withMace, gorbag, gorbagDef, 'elf');
    // 6 + 4 (override) = 10, under cap
    expect(combatProwessVsElf).toBe(gorbagDef.prowess + 4);
  });

  test('warrior gets only +3 prowess vs non-elf enemy (base applies)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const withMace = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, BLACK_MACE);
    const gorbagId = charIdAt(withMace, RESOURCE_PLAYER);
    const gorbag = withMace.players[0].characters[gorbagId as string];
    const gorbagDef = pool[GORBAG as string] as CharacterCard;

    const combatProwessVsOrc = computeCombatProwess(withMace, gorbag, gorbagDef, 'orc');
    expect(combatProwessVsOrc).toBe(gorbagDef.prowess + 3);
  });

  test('elf bonus capped at 10 (Lieutenant of Morgul base 8 vs elf)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LIEUTENANT_OF_MORGUL] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const withMace = attachItemToChar(base, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL, BLACK_MACE);
    const lotId = charIdAt(withMace, RESOURCE_PLAYER);
    const lot = withMace.players[0].characters[lotId as string];
    const lotDef = pool[LIEUTENANT_OF_MORGUL as string] as CharacterCard;

    // 8 + 4 = 12, capped at 10
    const combatProwessVsElf = computeCombatProwess(withMace, lot, lotDef, 'elf');
    expect(combatProwessVsElf).toBe(10);
  });

  // ── Effect 3: Non-warrior bearer gets no bonus ─────────────────────────

  test('non-warrior bearer gains no prowess bonus from Black Mace', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const withMace = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, LAYOS, BLACK_MACE));
    const layosId = charIdAt(withMace, RESOURCE_PLAYER);
    const layosDef = pool[LAYOS as string] as CharacterCard;

    // Layos is sage/diplomat — no warrior skill → no bonus
    expect(withMace.players[0].characters[layosId as string].effectiveStats.prowess)
      .toBe(layosDef.prowess);
  });

  test('non-warrior gets no +4 vs elf either (both effects gated on warrior skill)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const withMace = attachItemToChar(base, RESOURCE_PLAYER, LAYOS, BLACK_MACE);
    const layosId = charIdAt(withMace, RESOURCE_PLAYER);
    const layos = withMace.players[0].characters[layosId as string];
    const layosDef = pool[LAYOS as string] as CharacterCard;

    const combatProwessVsElf = computeCombatProwess(withMace, layos, layosDef, 'elf');
    expect(combatProwessVsElf).toBe(layosDef.prowess);
  });
});
