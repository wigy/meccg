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
  resetMint, pool, findCharInstanceId,
  buildSitePhaseState,
} from '../test-helpers.js';
import {
  computeLegalActions,
  THE_MITHRIL_COAT,
  isItemCard,
} from '../../index.js';
import type { CharacterCard, ItemCard } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('The Mithril-coat (tw-345)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('card definition has correct properties', () => {
    const def = pool[THE_MITHRIL_COAT as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-resource-item');
    expect(isItemCard(def)).toBe(true);

    const item = def as ItemCard;
    expect(item.name).toBe('The Mithril-coat');
    expect(item.unique).toBe(true);
    expect(item.subtype).toBe('greater');
    expect(item.keywords).toContain('armor');
    expect(item.marshallingPoints).toBe(4);
    expect(item.marshallingCategory).toBe('item');
    expect(item.corruptionPoints).toBe(2);
    expect(item.prowessModifier).toBe(0);
    expect(item.bodyModifier).toBe(3);
    expect(item.playableAt).toEqual(expect.arrayContaining(['ruins-and-lairs', 'shadow-hold', 'dark-hold']));
  });

  test('has stat-modifier effect for body +3 (max 10)', () => {
    const def = pool[THE_MITHRIL_COAT as string] as ItemCard;
    expect(def.effects).toBeDefined();
    expect(def.effects).toHaveLength(1);
    expect(def.effects![0]).toEqual({
      type: 'stat-modifier',
      stat: 'body',
      value: 3,
      max: 10,
    });
  });

  // ─── Body modifier without cap ──────────────────────────────────────────────

  test('character with body 6 gets +3 body (below max 10)', () => {
    // Théoden: base body 6, +3 = 9, which is below the max of 10
    const baseDef = pool[THEODEN as string] as CharacterCard;
    expect(baseDef.body).toBe(6);

    const state = recomputeDerived(buildSitePhaseState({
      characters: [{ defId: THEODEN, items: [THE_MITHRIL_COAT] }],
      site: MORIA,
    }));

    const theodenId = findCharInstanceId(state, 0, THEODEN);
    const stats = state.players[0].characters[theodenId as string].effectiveStats;
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

    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const stats = state.players[0].characters[aragornId as string].effectiveStats;
    expect(stats.body).toBe(10); // 9 + 3 = 12, capped to 10
  });

  // ─── Prowess unchanged ─────────────────────────────────────────────────────

  test('does not modify prowess', () => {
    const baseDef = pool[ARAGORN as string] as CharacterCard;

    const state = recomputeDerived(buildSitePhaseState({
      characters: [{ defId: ARAGORN, items: [THE_MITHRIL_COAT] }],
      site: MORIA,
    }));

    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const stats = state.players[0].characters[aragornId as string].effectiveStats;
    expect(stats.prowess).toBe(baseDef.prowess); // unchanged
  });

  // ─── Corruption points ─────────────────────────────────────────────────────

  test('adds 2 corruption points to bearer', () => {
    const state = recomputeDerived(buildSitePhaseState({
      characters: [{ defId: ARAGORN, items: [THE_MITHRIL_COAT] }],
      site: MORIA,
    }));

    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const stats = state.players[0].characters[aragornId as string].effectiveStats;
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
