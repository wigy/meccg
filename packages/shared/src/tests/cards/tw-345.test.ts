/**
 * @module tw-345.test
 *
 * Card test: The Mithril-coat (tw-345)
 * Type: hero-resource-item (greater item, armor)
 * Effects: 1
 *
 * "Unique. Armor. +3 to body (to a maximum of 10)."
 *
 * | # | Effect Type   | Status | Notes                             |
 * |---|---------------|--------|-----------------------------------|
 * | 1 | stat-modifier | OK     | +3 body, max 10                   |
 *
 * Playable: YES
 * Certified: 2026-04-07
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, THEODEN,
  MORIA,
  resetMint, pool,
  buildSitePhaseState,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import {
  computeLegalActions,
  THE_MITHRIL_COAT,
} from '../../index.js';
import type { CharacterCard } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('The Mithril-coat (tw-345)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────


  // ─── Body modifier without cap ──────────────────────────────────────────────

  test('character with body 6 gets +3 body (below max 10)', () => {
    // Théoden: base body 6, +3 = 9, which is below the max of 10
    const baseDef = pool[THEODEN as string] as CharacterCard;
    expect(baseDef.body).toBe(6);

    const state = recomputeDerived(buildSitePhaseState({
      characters: [{ defId: THEODEN, items: [THE_MITHRIL_COAT] }],
      site: MORIA,
    }));

    const stats = getCharacter(state, RESOURCE_PLAYER, THEODEN).effectiveStats;
    expect(stats.body).toBe(9); // 6 + 3 = 9, below max 10
  });

  // ─── Body modifier with cap ────────────────────────────────────────────────

  test('character with body 9 gets capped at max 10', () => {
    // Aragorn: base body 9, +3 = 12, capped to 10
    const baseDef = pool[ARAGORN as string] as CharacterCard;
    expect(baseDef.body).toBe(9);

    const state = recomputeDerived(buildSitePhaseState({
      characters: [{ defId: ARAGORN, items: [THE_MITHRIL_COAT] }],
      site: MORIA,
    }));

    const stats = getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats;
    expect(stats.body).toBe(10); // 9 + 3 = 12, capped to 10
  });

  // ─── Prowess unchanged ─────────────────────────────────────────────────────

  test('does not modify prowess', () => {
    const baseDef = pool[ARAGORN as string] as CharacterCard;

    const state = recomputeDerived(buildSitePhaseState({
      characters: [{ defId: ARAGORN, items: [THE_MITHRIL_COAT] }],
      site: MORIA,
    }));

    const stats = getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats;
    expect(stats.prowess).toBe(baseDef.prowess); // unchanged
  });

  // ─── Corruption points ─────────────────────────────────────────────────────

  test('adds 2 corruption points to bearer', () => {
    const state = recomputeDerived(buildSitePhaseState({
      characters: [{ defId: ARAGORN, items: [THE_MITHRIL_COAT] }],
      site: MORIA,
    }));

    const stats = getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats;
    expect(stats.corruptionPoints).toBe(2);
  });

  // ─── Playability ───────────────────────────────────────────────────────────

  test('playable at shadow-hold site (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [THE_MITHRIL_COAT],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions.filter(
      (a: { viable: boolean; action: { type: string } }) =>
        a.viable && a.action.type === 'play-hero-resource',
    );
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });
});
