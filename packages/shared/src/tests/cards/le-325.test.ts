/**
 * @module le-325.test
 *
 * Card test: The Mithril-coat (le-325)
 * Type: minion-resource-item (greater item, armor)
 * MP: 3, Corruption: 2
 *
 * "Unique. Armor. +3 to body (to a maximum of 10)."
 *
 * Engine support:
 * | # | Feature                        | Status      | Notes                                  |
 * |---|--------------------------------|-------------|----------------------------------------|
 * | 1 | +3 to body (to a maximum of 10)| IMPLEMENTED | stat-modifier body +3, max 10          |
 * | 2 | +2 corruption points to bearer | IMPLEMENTED | corruptionPoints summed in derived stats|
 * | 3 | Greater item site playability  | IMPLEMENTED | site playableResources gate            |
 *
 * Fixture alignment: minion (ringwraith) — uses minion characters and sites
 * from the LE set.
 *
 * Playable: YES
 * Certified: 2026-07-25
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, pool,
  buildMinionSitePhaseState,
  getCharacter, viableActions,
  PLAYER_1, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';

const MITHRIL_COAT_LE = 'le-325' as CardDefinitionId;

// Minion fixtures — declared locally per card-ids.ts constants policy.
const ODOACER = 'le-28' as CardDefinitionId;        // man, body 6
const GORBAG = 'le-11' as CardDefinitionId;         // orc, body 9
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // darkhaven (no items playable)
const MORIA_MINION = 'le-392' as CardDefinitionId;  // shadow-hold, greater items playable

describe('The Mithril-coat (le-325)', () => {
  beforeEach(() => resetMint());

  // ─── Effect: +3 body below the cap ────────────────────────────────────────

  test('bearer with body 6 gets +3 body (below max 10)', () => {
    // Odoacer: base body 6, +3 = 9, below the max of 10
    const baseDef = pool[ODOACER as string] as CharacterCard;
    expect(baseDef.body).toBe(6);

    const state = buildMinionSitePhaseState({
      characters: [{ defId: ODOACER, items: [MITHRIL_COAT_LE] }],
      site: MINAS_MORGUL,
    });

    const stats = getCharacter(state, RESOURCE_PLAYER, ODOACER).effectiveStats;
    expect(stats.body).toBe(9); // 6 + 3 = 9, below max 10
  });

  // ─── Effect: +3 body capped at 10 ─────────────────────────────────────────

  test('bearer with body 9 is capped at max 10', () => {
    // Gorbag: base body 9, +3 = 12, capped to 10
    const baseDef = pool[GORBAG as string] as CharacterCard;
    expect(baseDef.body).toBe(9);

    const state = buildMinionSitePhaseState({
      characters: [{ defId: GORBAG, items: [MITHRIL_COAT_LE] }],
      site: MINAS_MORGUL,
    });

    const stats = getCharacter(state, RESOURCE_PLAYER, GORBAG).effectiveStats;
    expect(stats.body).toBe(10); // 9 + 3 = 12, capped to 10
  });

  test('body not increased when the coat is not held', () => {
    const state = buildMinionSitePhaseState({
      characters: [{ defId: ODOACER }],
      site: MINAS_MORGUL,
    });

    const stats = getCharacter(state, RESOURCE_PLAYER, ODOACER).effectiveStats;
    expect(stats.body).toBe(6);
  });

  // ─── No prowess change ────────────────────────────────────────────────────

  test('does not modify prowess', () => {
    const baseDef = pool[ODOACER as string] as CharacterCard;

    const state = buildMinionSitePhaseState({
      characters: [{ defId: ODOACER, items: [MITHRIL_COAT_LE] }],
      site: MINAS_MORGUL,
    });

    const stats = getCharacter(state, RESOURCE_PLAYER, ODOACER).effectiveStats;
    expect(stats.prowess).toBe(baseDef.prowess); // unchanged
  });

  // ─── Corruption points ────────────────────────────────────────────────────

  test('adds 2 corruption points to bearer', () => {
    const state = buildMinionSitePhaseState({
      characters: [{ defId: ODOACER, items: [MITHRIL_COAT_LE] }],
      site: MINAS_MORGUL,
    });

    const stats = getCharacter(state, RESOURCE_PLAYER, ODOACER).effectiveStats;
    expect(stats.corruptionPoints).toBe(2);
  });

  // ─── Playability ──────────────────────────────────────────────────────────

  test('playable at Moria (shadow-hold, greater items allowed)', () => {
    const state = buildMinionSitePhaseState({
      characters: [{ defId: GORBAG }],
      site: MORIA_MINION,
      hand: [MITHRIL_COAT_LE],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at Minas Morgul (darkhaven, no items playable)', () => {
    const state = buildMinionSitePhaseState({
      characters: [{ defId: GORBAG }],
      site: MINAS_MORGUL,
      hand: [MITHRIL_COAT_LE],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });
});
