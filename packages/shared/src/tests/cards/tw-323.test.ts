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
  getCharacter, dispatchResult, expectCharStatus, expectInDiscardPile,
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

    const frodoChar = getCharacter(state, 0, FRODO);
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

    const frodoChar = getCharacter(state, 0, FRODO);
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

    const cheated = { ...state, cheatRollTotal: 7 };
    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const action = actions[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('test-gold-ring');

    const result = dispatchResult(cheated, action);
    const nextState = result.state;

    // Gandalf tapped, gold ring discarded
    expectCharStatus(nextState, 0, GANDALF, CardStatus.Tapped);
    expectInDiscardPile(nextState, 0, PRECIOUS_GOLD_RING);

    // Raw dice roll is 7, but modifier makes effective total 9
    expect(nextState.players[0].lastDiceRoll).toBeDefined();
    expect(nextState.players[0].lastDiceRoll!.die1 + nextState.players[0].lastDiceRoll!.die2).toBe(7);

    // Scroll of Isildur should still be on Frodo
    const frodoItems = getCharacter(nextState, 0, FRODO).items;
    const scrollStillPresent = frodoItems.some(
      item => state.cardPool[item.definitionId as string]?.name === 'Scroll of Isildur',
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

    const cheated = { ...state, cheatRollTotal: 7 };
    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const result = dispatchResult(cheated, actions[0].action);

    // Raw dice roll is 7, no modifier
    expect(result.state.players[0].lastDiceRoll).toBeDefined();
    expect(result.state.players[0].lastDiceRoll!.die1 + result.state.players[0].lastDiceRoll!.die2).toBe(7);
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
    const aragornChar = getCharacter(state, 0, ARAGORN);
    const effects = collectCharacterEffects(state, aragornChar, { reason: 'gold-ring-test' });
    const mod = resolveCheckModifier(effects, 'gold-ring-test');
    expect(mod).toBe(2);

    // The gold ring test action should still be available
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);
    expect((actions[0].action as ActivateGrantedAction).actionId).toBe('test-gold-ring');

    // Execute the test — modifier comes from Aragorn's Scroll
    const cheated = { ...state, cheatRollTotal: 5 };
    const result = dispatchResult(cheated, actions[0].action);
    expectCharStatus(result.state, 0, GANDALF, CardStatus.Tapped);
    expectInDiscardPile(result.state, 0, PRECIOUS_GOLD_RING);
  });
});
