/**
 * @module tw-499.test
 *
 * Card test: Dwarven Axe (tw-499)
 * Type: hero-resource-item (major, weapon)
 *
 * Printed text:
 *   "Weapon. Warrior only: +2 prowess (to a maximum of 7);
 *    +3 prowess if held by a Dwarf (to a maximum of 8)."
 *
 * Rule coverage:
 *
 * | # | Effect Type   | Status | Notes                                                       |
 * |---|---------------|--------|-------------------------------------------------------------|
 * | 1 | stat-modifier | OK     | +2 prowess (max 7) for a warrior bearer, id dwarven-axe-prowess |
 * | 2 | stat-modifier | OK     | +3 prowess (max 8) for a warrior Dwarf, overrides dwarven-axe-prowess |
 *
 * "Warrior only" gates BOTH branches — a non-warrior bearer receives nothing.
 * Every Dwarf in the pool happens to be a warrior, so the Dwarf branch is only
 * ever reachable by a warrior; the override replaces (does not stack with) the
 * base +2, so a Dwarf warrior gets +3, never +5.
 *
 * Playable: YES
 * Certified: 2026-07-09
 *
 * Characters used:
 *   BEREGOND (tw-127): dúnadan, warrior, prowess 4
 *   ARAGORN  (tw-120): dúnadan, warrior, prowess 6
 *   KILI     (tw-167): dwarf,   warrior, prowess 3
 *   GIMLI    (tw-159): dwarf,   warrior, prowess 5
 *   FRODO    (tw-152): hobbit,  scout/diplomat (non-warrior), prowess 1
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, BEREGOND, KILI, GIMLI, FRODO,
  MORIA,
  pool,
  buildSitePhaseState, resetMint,
  getCharacter, viableActions,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';

const DWARVEN_AXE = 'tw-499' as CardDefinitionId;

describe('Dwarven Axe (tw-499)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: Warrior base bonus (+2, max 7) ─────────────────────────────────

  test('warrior non-dwarf gets +2 prowess (below the cap)', () => {
    // Beregond (warrior, prowess 4): 4 + 2 = 6, below max 7
    const baseDef = pool[BEREGOND as string] as CharacterCard;
    expect(baseDef.prowess).toBe(4);
    expect(baseDef.skills).toContain('warrior');
    expect(baseDef.race).not.toBe('dwarf');

    const state = recomputeDerived(buildSitePhaseState({
      characters: [{ defId: BEREGOND, items: [DWARVEN_AXE] }],
      site: MORIA,
    }));

    expect(getCharacter(state, RESOURCE_PLAYER, BEREGOND).effectiveStats.prowess).toBe(6);
  });

  test('warrior non-dwarf prowess is capped at 7', () => {
    // Aragorn (warrior, prowess 6): 6 + 2 = 8 → capped at 7
    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.prowess).toBe(6);

    const state = recomputeDerived(buildSitePhaseState({
      characters: [{ defId: ARAGORN, items: [DWARVEN_AXE] }],
      site: MORIA,
    }));

    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(7);
  });

  // ─── Rule 2: Dwarf bonus (+3, max 8) overrides the base ─────────────────────

  test('dwarf warrior gets +3 prowess (override replaces base, not +5)', () => {
    // Kíli (dwarf warrior, prowess 3): 3 + 3 = 6 (NOT 3 + 2 + 3 = 8)
    const baseDef = pool[KILI as string] as CharacterCard;
    expect(baseDef.prowess).toBe(3);
    expect(baseDef.race).toBe('dwarf');
    expect(baseDef.skills).toContain('warrior');

    const state = recomputeDerived(buildSitePhaseState({
      characters: [{ defId: KILI, items: [DWARVEN_AXE] }],
      site: MORIA,
    }));

    expect(getCharacter(state, RESOURCE_PLAYER, KILI).effectiveStats.prowess).toBe(6);
  });

  test('dwarf warrior prowess is capped at 8', () => {
    // Gimli (dwarf warrior, prowess 5): 5 + 3 = 8, exactly at max 8
    const baseDef = pool[GIMLI as string] as CharacterCard;
    expect(baseDef.prowess).toBe(5);

    const state = recomputeDerived(buildSitePhaseState({
      characters: [{ defId: GIMLI, items: [DWARVEN_AXE] }],
      site: MORIA,
    }));

    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(8);
  });

  // ─── "Warrior only" gate ────────────────────────────────────────────────────

  test('non-warrior bearer receives no prowess bonus', () => {
    // Frodo (hobbit, scout/diplomat — no warrior skill, prowess 1): stays 1
    const baseDef = pool[FRODO as string] as CharacterCard;
    expect(baseDef.skills).not.toContain('warrior');

    const state = recomputeDerived(buildSitePhaseState({
      characters: [{ defId: FRODO, items: [DWARVEN_AXE] }],
      site: MORIA,
    }));

    expect(getCharacter(state, RESOURCE_PLAYER, FRODO).effectiveStats.prowess).toBe(baseDef.prowess);
  });

  // ─── Baseline: without the axe, prowess is unchanged ────────────────────────

  test('without the axe prowess is unchanged', () => {
    const baseDef = pool[BEREGOND as string] as CharacterCard;

    const state = recomputeDerived(buildSitePhaseState({
      characters: [BEREGOND],
      site: MORIA,
    }));

    expect(getCharacter(state, RESOURCE_PLAYER, BEREGOND).effectiveStats.prowess).toBe(baseDef.prowess);
  });

  // ─── Playability ─────────────────────────────────────────────────────────────

  test('playable as a major item at Moria', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GIMLI],
      hand: [DWARVEN_AXE],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });
});
