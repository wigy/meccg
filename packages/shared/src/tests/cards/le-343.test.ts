/**
 * @module le-343.test
 *
 * Card: Scroll of Isildur (le-343)
 * Type: minion-resource-item (greater)
 * Effects:
 *   check-modifier: gold-ring-test +1 (modifier applied to any gold-ring test in bearer's company)
 *   storable-at: Barad-dûr for 5 MPs (exclusively; not storable at other darkHavens)
 *
 * Card text: "Unique. When a gold ring is tested in a company bearing the Scroll
 *  of Isildur, the random value obtained is modified by +1. May be stored at
 *  Barad-dûr for 5 marshalling points."
 *
 * | # | Effect                              | Status      | Notes                              |
 * |---|-------------------------------------|-------------|------------------------------------|
 * | 1 | check-modifier gold-ring-test +1    | IMPLEMENTED | collected via collectCharacterEffects |
 * | 2 | storable-at Barad-dûr, 5 MPs        | IMPLEMENTED | storable-at effect + store-item    |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, CardInstanceId } from '../../index.js';
import { Alignment } from '../../index.js';
import {
  PLAYER_1, PLAYER_2,
  Phase,
  buildTestState, resetMint, mint,
  findCharInstanceId, viableActions, dispatch,
  enqueueGoldRingTest,
  addToPile,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { collectCharacterEffects, resolveCheckModifier } from '../../engine/effects/index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const SCROLL_OF_ISILDUR_MINION = 'le-343' as CardDefinitionId;
const LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId;
const GRISHNAKH = 'le-12' as CardDefinitionId;   // minion character, orc
const LUITPRAND = 'le-23' as CardDefinitionId;   // minion character, man, mind 1
const BARAD_DUR = 'le-352' as CardDefinitionId;  // dark-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // darkhaven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold (site deck)

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Scroll of Isildur (le-343)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 gold-ring-test check-modifier ──

  test('resolver collects +1 gold-ring-test modifier from Scroll bearer', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MINAS_MORGUL,
            characters: [
              { defId: GRISHNAKH, items: [LEAST_OF_GOLD_RINGS, SCROLL_OF_ISILDUR_MINION] },
            ],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const grishnakhChar = state.players[RESOURCE_PLAYER].characters[
      findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH)
    ];
    const effects = collectCharacterEffects(state, grishnakhChar, { reason: 'gold-ring-test' });
    const mod = resolveCheckModifier(effects, 'gold-ring-test');
    expect(mod).toBe(1);
  });

  test('no gold-ring-test modifier when Scroll not in company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MINAS_MORGUL,
            characters: [
              { defId: GRISHNAKH, items: [LEAST_OF_GOLD_RINGS] },
            ],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const grishnakhChar = state.players[RESOURCE_PLAYER].characters[
      findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH)
    ];
    const effects = collectCharacterEffects(state, grishnakhChar, { reason: 'gold-ring-test' });
    const mod = resolveCheckModifier(effects, 'gold-ring-test');
    expect(mod).toBe(0);
  });

  test('Scroll on companion in same company still provides +1 modifier', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MINAS_MORGUL,
            characters: [
              { defId: GRISHNAKH, items: [LEAST_OF_GOLD_RINGS] },
              { defId: LUITPRAND, items: [SCROLL_OF_ISILDUR_MINION] },
            ],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const luitprandChar = state.players[RESOURCE_PLAYER].characters[
      findCharInstanceId(state, RESOURCE_PLAYER, LUITPRAND)
    ];
    const effects = collectCharacterEffects(state, luitprandChar, { reason: 'gold-ring-test' });
    expect(resolveCheckModifier(effects, 'gold-ring-test')).toBe(1);
  });

  test('gold-ring auto-test applies +1 modifier from Scroll in company', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MINAS_MORGUL,
            characters: [
              { defId: GRISHNAKH, items: [SCROLL_OF_ISILDUR_MINION] },
              LUITPRAND,
            ],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const luitprandId = findCharInstanceId(base, RESOURCE_PLAYER, LUITPRAND);

    // Simulate org-phase store path: gold ring moved to killPile (MP pile)
    const ringInstance: { instanceId: CardInstanceId; definitionId: CardDefinitionId } = {
      instanceId: mint(),
      definitionId: LEAST_OF_GOLD_RINGS,
    };
    const withRingStored = addToPile(base, RESOURCE_PLAYER, 'killPile', ringInstance);

    // Enqueue gold-ring-test with no site modifier (rollModifier = 0)
    const withPending = enqueueGoldRingTest(
      withRingStored, PLAYER_1, ringInstance.instanceId, luitprandId,
    );

    // Cheat roll total = 7; Scroll adds +1 → effective total = 8
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 7 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    // Roll stored in lastDiceRoll; die total should be 7 (not 8 — Scroll bonus is applied separately)
    expect(afterRoll.players[RESOURCE_PLAYER].lastDiceRoll).toBeDefined();
    expect(afterRoll.players[RESOURCE_PLAYER].lastDiceRoll!.die1
      + afterRoll.players[RESOURCE_PLAYER].lastDiceRoll!.die2).toBe(7);

    // With effective total 8 (7 + 1), lesser-ring (any) is eligible
    const playActions = viableActions(afterRoll, PLAYER_1, 'pass');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('gold-ring auto-test with no Scroll applies no modifier', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MINAS_MORGUL,
            characters: [GRISHNAKH, LUITPRAND],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const grishnakhId = findCharInstanceId(base, RESOURCE_PLAYER, GRISHNAKH);

    const ringInstance: { instanceId: CardInstanceId; definitionId: CardDefinitionId } = {
      instanceId: mint(),
      definitionId: LEAST_OF_GOLD_RINGS,
    };
    const withRingStored = addToPile(base, RESOURCE_PLAYER, 'killPile', ringInstance);
    const withPending = enqueueGoldRingTest(
      withRingStored, PLAYER_1, ringInstance.instanceId, grishnakhId,
    );

    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 7 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    expect(afterRoll.players[RESOURCE_PLAYER].lastDiceRoll).toBeDefined();
    expect(afterRoll.players[RESOURCE_PLAYER].lastDiceRoll!.die1
      + afterRoll.players[RESOURCE_PLAYER].lastDiceRoll!.die2).toBe(7);
  });

  // ── Effect 2: storable-at Barad-dûr for 5 MPs ──

  test('store-item action is offered when character with Scroll is at Barad-dûr', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: BARAD_DUR,
            characters: [{ defId: GRISHNAKH, items: [SCROLL_OF_ISILDUR_MINION] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
  });

  test('store-item action is NOT offered at Minas Morgul (Scroll only stores at Barad-dûr)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MINAS_MORGUL,
            characters: [{ defId: GRISHNAKH, items: [SCROLL_OF_ISILDUR_MINION] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(0);
  });

  test('5 marshalling points awarded when Scroll is stored (in killPile, the MP pile)', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR, characters: [GRISHNAKH] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const scrollInstance = { instanceId: mint(), definitionId: SCROLL_OF_ISILDUR_MINION };
    const withScrollStored = addToPile(base, RESOURCE_PLAYER, 'killPile', scrollInstance);
    const state = recomputeDerived(withScrollStored);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(5);
  });

  test('dispatching store-item at Barad-dûr moves Scroll to killPile (MP pile)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: BARAD_DUR,
            characters: [{ defId: GRISHNAKH, items: [SCROLL_OF_ISILDUR_MINION] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const storeAction = viableActions(state, PLAYER_1, 'store-item')[0].action;
    const afterStore = dispatch(state, storeAction);

    // Scroll should be in killPile (MP pile)
    expect(afterStore.players[RESOURCE_PLAYER].killPile.some(
      c => c.definitionId === SCROLL_OF_ISILDUR_MINION,
    )).toBe(true);
    // Scroll should no longer be on Grishnákh
    const grishnakhId = findCharInstanceId(afterStore, RESOURCE_PLAYER, GRISHNAKH);
    const items = afterStore.players[RESOURCE_PLAYER].characters[grishnakhId].items;
    expect(items.some(i => i.definitionId === SCROLL_OF_ISILDUR_MINION)).toBe(false);
  });
});
