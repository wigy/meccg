/**
 * @module tw-156.test
 *
 * Card test: Gandalf (tw-156)
 * Type: hero-character (wizard)
 * Effects: 2
 *
 * "Unique. +1 to all of his corruption checks. Gandalf may tap to test
 *  a gold ring in his company."
 *
 * Engine Support:
 * | # | Feature                              | Status      | Notes                                  |
 * |---|--------------------------------------|-------------|----------------------------------------|
 * | 1 | +1 corruption check modifier         | IMPLEMENTED | check-modifier effect + corruptionModifier stat |
 * | 2 | Tap to test gold ring in company     | IMPLEMENTED | grant-action test-gold-ring             |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GANDALF, ARAGORN, LEGOLAS, FRODO,
  PRECIOUS_GOLD_RING, GLAMDRING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase, CardStatus,
  buildTestState, resetMint,
  findCharInstanceId, viableActions,
  enqueueTransferCorruptionCheck,
  getCharacter, dispatch, dispatchResult, expectCharStatus, expectCharItemCount, expectInDiscardPile,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CorruptionCheckAction, ActivateGrantedAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Gandalf (tw-156)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 corruption check modifier ──


  test('+1 corruption modifier decreases need on pending corruption check', () => {
    // Build state with Gandalf holding Glamdring and a pending corruption check
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gandalfId = findCharInstanceId(state, 0, GANDALF);
    const glamdringInstId = getCharacter(state, 0, GANDALF).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, gandalfId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(gandalfId);
    // corruptionModifier is +1, which makes checks easier
    expect(ccActions[0].corruptionModifier).toBe(1);
    // need = CP + 1 - modifier. With modifier +1, need = CP.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - 1);
  });

  // ── Effect 2: grant-action test-gold-ring ──

  test('untapped Gandalf with gold ring in company can activate test-gold-ring', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF, { defId: FRODO, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const action = actions[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('test-gold-ring');
    expect(action.characterId).toBe(findCharInstanceId(state, 0, GANDALF));
    expect(action.targetCardId).toBeDefined();

    // The target should be the gold ring instance
    const ringInstanceId = getCharacter(state, 0, FRODO).items[0].instanceId;
    expect(action.targetCardId).toBe(ringInstanceId);
  });

  test('tapped Gandalf cannot activate test-gold-ring', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: GANDALF, status: CardStatus.Tapped },
              { defId: FRODO, items: [PRECIOUS_GOLD_RING] },
            ],
          }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(0);
  });

  test('no gold ring in company means no test-gold-ring action', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF, { defId: FRODO, items: [GLAMDRING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(0);
  });

  test('test-gold-ring taps Gandalf, rolls 2d6, and discards the gold ring', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF, { defId: FRODO, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Cheat roll to a specific value so we can verify the roll happened
    const cheated = { ...state, cheatRollTotal: 10 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const result = dispatchResult(cheated, actions[0].action);
    const nextState = result.state;

    // Gandalf should be tapped
    expectCharStatus(nextState, 0, GANDALF, CardStatus.Tapped);

    // Gold ring should be removed from Frodo's items
    expectCharItemCount(nextState, 0, FRODO, 0);

    // Gold ring should be in the player's discard pile
    expectInDiscardPile(nextState, 0, PRECIOUS_GOLD_RING);

    // A dice roll should have been recorded
    expect(nextState.players[0].lastDiceRoll).toBeDefined();
    expect(nextState.players[0].lastDiceRoll!.die1 + nextState.players[0].lastDiceRoll!.die2).toBe(10);

    // A dice-roll effect should have been emitted
    expect(result.effects).toBeDefined();
    expect(result.effects!.some(e => e.effect === 'dice-roll')).toBe(true);
  });

  test('Gandalf can test his own gold ring (not just other characters)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const cheated = { ...state, cheatRollTotal: 7 };
    const nextState = dispatch(cheated, actions[0].action);

    // Gandalf should be tapped and gold ring should be discarded
    expectCharStatus(nextState, 0, GANDALF, CardStatus.Tapped);
    expectCharItemCount(nextState, 0, GANDALF, 0);
    expectInDiscardPile(nextState, 0, PRECIOUS_GOLD_RING);
  });
});
