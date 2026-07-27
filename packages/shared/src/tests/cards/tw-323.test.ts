/**
 * @module tw-323.test
 *
 * Card test: Scroll of Isildur (tw-323)
 * Type: hero-resource-item (greater)
 * Effects: 1
 *
 * "Unique. When a gold ring is tested in a company with the Scroll of
 *  Isildur, the result of the roll is modified by +2."
 *
 * Engine Support:
 * | # | Feature                              | Status      | Notes                            |
 * |---|--------------------------------------|-------------|----------------------------------|
 * | 1 | +2 gold ring test roll modifier      | IMPLEMENTED | check-modifier gold-ring-test    |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GANDALF, ARAGORN, FRODO,
  PRECIOUS_GOLD_RING, SCROLL_OF_ISILDUR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase, CardStatus,
  buildTestState, resetMint,
  viableActions,
  getCharacter, expectCharStatus, expectInDiscardPile, RESOURCE_PLAYER,
  testGoldRingViaWizard, ringPlayOffer,
} from '../test-helpers.js';
import type { ActivateGrantedAction } from '../../index.js';
import { collectCharacterEffects, resolveCheckModifier } from '../../engine/effects/index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Scroll of Isildur (tw-323)', () => {
  beforeEach(() => resetMint());

  // ── Card definition ──


  // ── Effect 1: +2 to gold ring test rolls ──

  test('resolver collects +2 gold-ring-test modifier from Scroll bearer items', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              GANDALF,
              { defId: FRODO, items: [PRECIOUS_GOLD_RING, SCROLL_OF_ISILDUR] },
            ],
          }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const frodoChar = getCharacter(state, RESOURCE_PLAYER, FRODO);
    const effects = collectCharacterEffects(state, frodoChar, { reason: 'gold-ring-test' });
    const mod = resolveCheckModifier(effects, 'gold-ring-test');
    expect(mod).toBe(2);
  });

  test('resolver returns 0 when no Scroll of Isildur in company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              GANDALF,
              { defId: FRODO, items: [PRECIOUS_GOLD_RING] },
            ],
          }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const frodoChar = getCharacter(state, RESOURCE_PLAYER, FRODO);
    const effects = collectCharacterEffects(state, frodoChar, { reason: 'gold-ring-test' });
    const mod = resolveCheckModifier(effects, 'gold-ring-test');
    expect(mod).toBe(0);
  });

  test('gold ring test with Scroll in company applies +2 modifier to roll', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              GANDALF,
              { defId: FRODO, items: [PRECIOUS_GOLD_RING, SCROLL_OF_ISILDUR] },
            ],
          }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Gandalf taps to test the ring, then the queued `gold-ring-test` is rolled.
    const nextState = testGoldRingViaWizard(state, PLAYER_1, 7);

    // Gandalf tapped, gold ring discarded
    expectCharStatus(nextState, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    expectInDiscardPile(nextState, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);

    // Raw dice roll is 7, but the Scroll makes the effective total 9 — which is
    // inside the Precious Gold Ring's Dwarven-ring band (8–12), unlike a raw 7.
    expect(nextState.players[RESOURCE_PLAYER].lastDiceRoll).toBeDefined();
    expect(nextState.players[RESOURCE_PLAYER].lastDiceRoll!.die1 + nextState.players[RESOURCE_PLAYER].lastDiceRoll!.die2).toBe(7);

    const offer = ringPlayOffer(nextState, PLAYER_1);
    expect(offer.rollTotal).toBe(9);
    expect(offer.eligibleCategories).toContain('dwarven-ring');

    // Scroll of Isildur should still be on Frodo
    const frodoItems = getCharacter(nextState, RESOURCE_PLAYER, FRODO).items;
    const scrollStillPresent = frodoItems.some(
      item => state.cardPool[item.definitionId]?.name === 'Scroll of Isildur',
    );
    expect(scrollStillPresent).toBe(true);
  });

  test('gold ring test without Scroll gets no modifier', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              GANDALF,
              { defId: FRODO, items: [PRECIOUS_GOLD_RING] },
            ],
          }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const nextState = testGoldRingViaWizard(state, PLAYER_1, 7);

    // Raw dice roll is 7, no modifier
    expect(nextState.players[RESOURCE_PLAYER].lastDiceRoll).toBeDefined();
    expect(nextState.players[RESOURCE_PLAYER].lastDiceRoll!.die1 + nextState.players[RESOURCE_PLAYER].lastDiceRoll!.die2).toBe(7);

    // Without the Scroll the effective total stays at 7 — below the Dwarven-ring band.
    const offer = ringPlayOffer(nextState, PLAYER_1);
    expect(offer.rollTotal).toBe(7);
    expect(offer.eligibleCategories).not.toContain('dwarven-ring');
  });

  test('Scroll on different character in same company still provides +2', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              GANDALF,
              { defId: FRODO, items: [PRECIOUS_GOLD_RING] },
              { defId: ARAGORN, items: [SCROLL_OF_ISILDUR] },
            ],
          }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Collect effects from Aragorn (who holds the Scroll)
    const aragornChar = getCharacter(state, RESOURCE_PLAYER, ARAGORN);
    const effects = collectCharacterEffects(state, aragornChar, { reason: 'gold-ring-test' });
    const mod = resolveCheckModifier(effects, 'gold-ring-test');
    expect(mod).toBe(2);

    // The gold ring test action should still be available
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);
    expect((actions[0].action as ActivateGrantedAction).actionId).toBe('test-gold-ring');

    // Execute the test — modifier comes from Aragorn's Scroll
    const afterRoll = testGoldRingViaWizard(state, PLAYER_1, 5);
    expectCharStatus(afterRoll, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    expectInDiscardPile(afterRoll, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
    expect(ringPlayOffer(afterRoll, PLAYER_1).rollTotal).toBe(7);
  });
});
