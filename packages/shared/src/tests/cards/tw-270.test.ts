/**
 * @module tw-270.test
 *
 * Card test: Lucky Strike (tw-270)
 * Type: hero-resource-event (short)
 * Effects: 1 (reroll-strike, warrior-only filter)
 *
 * "Warrior only. Make two rolls against a strike and choose one of the
 * two results to use."
 *
 * This tests:
 * 1. reroll-strike effect — play-reroll-strike action appears during
 *    resolve-strike when the target character is a warrior
 * 2. Warrior-only filter blocks the action when the target character is
 *    not a warrior
 * 3. Two dice rolls are emitted (kept + discarded) and the better total
 *    is used
 * 4. Character taps on success (like normal tap-to-fight)
 * 5. Lucky Strike card is discarded from hand after use
 * 6. play-reroll-strike not available when no Lucky Strike card in hand
 * 7. Lucky Strike is combat-only — not playable outside combat
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FRODO,
  CAVE_DRAKE,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  setupCombatWithCaveDrake, assignBothStrikesTo,
  handCardId, dispatchResult, expectCharStatus, expectInDiscardPile,
  actionAs, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus } from '../../index.js';
import type {
  CardDefinitionId,
  PlayShortEventAction,
  NotPlayableAction,
  ResolveStrikeAction,
} from '../../index.js';

// Lucky Strike is only used in this single test file (per card-ids.ts policy,
// single-use IDs stay local to their consumer).
const LUCKY_STRIKE = 'tw-270' as CardDefinitionId;

type PlayRerollAction = {
  readonly type: 'play-reroll-strike';
  readonly player: typeof PLAYER_1;
  readonly cardInstanceId: ReturnType<typeof handCardId>;
  readonly need: number;
  readonly explanation: string;
};

describe('Lucky Strike (tw-270)', () => {
  beforeEach(() => resetMint());

  test('play-reroll-strike appears when Lucky Strike is in hand and target is a warrior', () => {
    const s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
      heroHand: [LUCKY_STRIKE],
    });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const actions = computeLegalActions(s1, PLAYER_1);
    const rerollActions = actions.filter(a => a.viable && a.action.type === 'play-reroll-strike');
    expect(rerollActions.length).toBe(1);
    expect(actionAs<PlayRerollAction>(rerollActions[0].action).cardInstanceId).toBe(
      handCardId(s1, RESOURCE_PLAYER),
    );
  });

  test('play-reroll-strike does not appear when target is not a warrior', () => {
    const s0 = setupCombatWithCaveDrake({
      heroChars: [FRODO, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
      heroHand: [LUCKY_STRIKE],
    });
    const s1 = assignBothStrikesTo(s0, FRODO);

    const actions = computeLegalActions(s1, PLAYER_1);
    const rerollActions = actions.filter(a => a.viable && a.action.type === 'play-reroll-strike');
    expect(rerollActions.length).toBe(0);
  });

  test('play-reroll-strike appears for warrior target even when a non-warrior is in the same company', () => {
    const s0 = setupCombatWithCaveDrake({
      heroChars: [FRODO, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
      heroHand: [LUCKY_STRIKE],
    });
    const s1 = assignBothStrikesTo(s0, LEGOLAS);

    const actions = computeLegalActions(s1, PLAYER_1);
    const rerollActions = actions.filter(a => a.viable && a.action.type === 'play-reroll-strike');
    expect(rerollActions.length).toBe(1);
  });

  test('reroll uses the better of two rolls and the card is discarded', () => {
    const s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
      heroHand: [LUCKY_STRIKE],
    });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const rerollAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-reroll-strike')!;

    // First roll cheated to 12 — always the better of the two. Aragorn
    // prowess 6 + 12 = 18 > Cave-drake prowess 10 → success.
    const result = dispatchResult({ ...s1, cheatRollTotal: 12 }, rerollAction.action);
    const s2 = result.state;

    // Aragorn taps on success (like tap-to-fight).
    expectCharStatus(s2, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    // Lucky Strike is discarded from hand.
    expect(s2.players[0].hand.length).toBe(0);
    expectInDiscardPile(s2, RESOURCE_PLAYER, LUCKY_STRIKE);

    // Two dice-roll effects are emitted — the discarded roll and the kept
    // roll. The kept roll's total is the max of the two totals.
    const diceEffects = result.effects!.filter(e => e.effect === 'dice-roll');
    expect(diceEffects.length).toBe(2);
    const totals = diceEffects.map(e => {
      const d = e as { die1: number; die2: number };
      return d.die1 + d.die2;
    });
    const keptEffect = diceEffects.find(e => !(e as { label: string }).label.includes('discarded'))!;
    const keptTotal = (keptEffect as { die1: number; die2: number }).die1
      + (keptEffect as { die1: number; die2: number }).die2;
    expect(keptTotal).toBe(Math.max(...totals));
    expect(keptTotal).toBe(12);

    // Cave-drake has no body and both strikes resolved against Aragorn
    // (one normal + one excess) defeat the creature on success, so combat
    // finalizes. Aragorn's status (tapped, not wounded) is the proof of
    // a successful outcome — verified above. Confirm combat ended cleanly.
    expect(s2.combat).toBeNull();
  });

  test('poor first roll is overridden when the second roll is better', () => {
    // First roll cheated to 2 (worst possible). Second roll uses the RNG,
    // which is non-deterministic from the test's perspective — but the
    // reroll must keep whichever roll produced the higher total.
    // Aragorn prowess 6: if first=2 → total 8 (would wound vs 10).
    // Whatever RNG yields, the kept total equals max(2, rng_total), and
    // the outcome is driven by that max — i.e. never worse than first=2.
    const s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
      heroHand: [LUCKY_STRIKE],
    });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const rerollAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-reroll-strike')!;

    const result = dispatchResult({ ...s1, cheatRollTotal: 2 }, rerollAction.action);

    const diceEffects = result.effects!.filter(e => e.effect === 'dice-roll');
    expect(diceEffects.length).toBe(2);
    const totals = diceEffects.map(e => {
      const d = e as { die1: number; die2: number };
      return d.die1 + d.die2;
    });

    // First roll was cheated to 2; the other roll was from RNG.
    expect(totals).toContain(2);
    const keptEffect = diceEffects.find(e => !(e as { label: string }).label.includes('discarded'))!;
    const keptTotal = (keptEffect as { die1: number; die2: number }).die1
      + (keptEffect as { die1: number; die2: number }).die2;
    // The kept total is always the max of the two rolls.
    expect(keptTotal).toBe(Math.max(...totals));
    expect(keptTotal).toBeGreaterThanOrEqual(2);
  });

  test('Lucky Strike grants full (tap-to-fight) prowess — same need as tap-to-fight', () => {
    const s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
      heroHand: [LUCKY_STRIKE],
    });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const actions = computeLegalActions(s1, PLAYER_1);
    const rerollAction = actions.find(a => a.viable && a.action.type === 'play-reroll-strike') as
      { action: PlayRerollAction } | undefined;
    const tapAction = actions.find(a => a.viable && a.action.type === 'resolve-strike' &&
      actionAs<ResolveStrikeAction>(a.action).tapToFight === true) as
      { action: { need: number } } | undefined;

    expect(rerollAction).toBeDefined();
    expect(tapAction).toBeDefined();
    expect(rerollAction!.action.need).toBe(tapAction!.action.need);
  });

  test('play-reroll-strike not available when Lucky Strike is not in hand', () => {
    const s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
    });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const actions = computeLegalActions(s1, PLAYER_1);
    const rerollActions = actions.filter(a => a.viable && a.action.type === 'play-reroll-strike');
    expect(rerollActions.length).toBe(0);
  });

  test('Lucky Strike is not playable as a short event during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
          hand: [LUCKY_STRIKE],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const luckyAsShortEvent = actions.find(
      a => a.viable && a.action.type === 'play-short-event' &&
        actionAs<PlayShortEventAction>(a.action).cardInstanceId === state.players[0].hand[0].instanceId,
    );
    expect(luckyAsShortEvent).toBeUndefined();

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable' &&
        actionAs<NotPlayableAction>(a.action).cardInstanceId === state.players[0].hand[0].instanceId,
    );
    expect(notPlayable).toBeDefined();
  });
});
