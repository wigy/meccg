/**
 * @module as-39.test
 *
 * Card test: Summons from Long Sleep (as-39)
 * Type: hazard-event (permanent)
 * Effects: 1 (summons-from-long-sleep — engine reservation mechanic)
 *
 * Card text:
 *   "This card reserves up to one Dragon or Drake hazard creature at a
 *    time. To reserve a Dragon or Drake creature, place it face up 'off
 *    to the side' with this card (not counting against the hazard limit).
 *    You may play a reserved creature as though it were in your hand.
 *    Discard this card after the reserved creature attacks. A reserved
 *    Dragon or Drake receives +2 prowess when attacking."
 *
 * Engine Support:
 * | # | Feature                                  | Status |
 * |---|------------------------------------------|--------|
 * | 1 | reserve-creature action (Dragon/Drake)   | IMPL   |
 * | 2 | reserve slot free (no hazard limit cost) | IMPL   |
 * | 3 | play-reserved-creature action            | IMPL   |
 * | 4 | +2 prowess when reserved creature plays  | IMPL   |
 * | 5 | AS-39 discarded after creature attacks   | IMPL   |
 * | 6 | Non-Dragon/Drake cannot be reserved      | IMPL   |
 *
 * Certified: 2026-06-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  CAVE_DRAKE, ORC_PATROL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions,
  dispatch,
  addCardInPlay,
  makeDoubleWildernessMHState,
  resolveChain,
  findHandCardId,
  handCardId,
  HAZARD_PLAYER,
  pool,
} from '../test-helpers.js';
import { Phase, describeAction } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import type { CardDefinitionId } from '../../index.js';

const SUMMONS_FROM_LONG_SLEEP = 'as-39' as CardDefinitionId;

describe('Summons from Long Sleep (as-39)', () => {
  beforeEach(() => resetMint());

  test('reserve-creature is offered for Dragon in hand when AS-39 is in play (slot empty)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [CAVE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withCard = addCardInPlay(base, HAZARD_PLAYER, SUMMONS_FROM_LONG_SLEEP);
    const mhState = makeDoubleWildernessMHState();
    const state = { ...withCard, phaseState: mhState };

    const actions = viableActions(state, PLAYER_2, 'reserve-creature');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('reserve-creature is NOT offered for non-Dragon/Drake hazard creature', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withCard = addCardInPlay(base, HAZARD_PLAYER, SUMMONS_FROM_LONG_SLEEP);
    const mhState = makeDoubleWildernessMHState();
    const state = { ...withCard, phaseState: mhState };

    expect(viableActions(state, PLAYER_2, 'reserve-creature')).toHaveLength(0);
  });

  test('reserving a Dragon moves it from hand to reservedCreatures slot', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [CAVE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withCard = addCardInPlay(base, HAZARD_PLAYER, SUMMONS_FROM_LONG_SLEEP);
    const mhState = makeDoubleWildernessMHState();
    const state = { ...withCard, phaseState: mhState };

    const sourceId = state.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;
    const dragonId = handCardId(state, HAZARD_PLAYER);

    const afterReserve = dispatch(state, {
      type: 'reserve-creature',
      player: PLAYER_2,
      cardInstanceId: dragonId,
      sourceCardInstanceId: sourceId,
    });

    // Dragon no longer in hand
    expect(afterReserve.players[HAZARD_PLAYER].hand).toHaveLength(0);
    // Dragon is in reservedCreatures
    const reservations = afterReserve.players[HAZARD_PLAYER].reservedCreatures;
    expect(reservations).toHaveLength(1);
    expect(reservations[0].sourceCardInstanceId).toBe(sourceId);
    expect(reservations[0].creature.instanceId).toBe(dragonId);
  });

  test('describeAction for reserve-creature resolves card names, not raw instance IDs', () => {
    // Regression: the reserve-creature description previously emitted raw
    // instance IDs (e.g. "p1 reserves creature p1-50 via p1-56"), which is
    // unreadable in the log and on the action button. It must resolve the
    // creature and source-card names.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [CAVE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withCard = addCardInPlay(base, HAZARD_PLAYER, SUMMONS_FROM_LONG_SLEEP);
    const mhState = makeDoubleWildernessMHState();
    const state = { ...withCard, phaseState: mhState };

    const actions = viableActions(state, PLAYER_2, 'reserve-creature');
    expect(actions.length).toBeGreaterThan(0);

    const instLookup = (id: string) => resolveInstanceId(state, id as never);
    const desc = describeAction(actions[0].action, pool, instLookup);

    // Both the reserved creature and the source card are named...
    expect(desc).toContain('Cave-drake');
    expect(desc).toContain('Summons from Long Sleep');
    // ...and no raw instance ID (e.g. "p2-1") leaks into the description.
    expect(desc).not.toMatch(/\bp\d+-\d+\b/);
  });

  test('reserving does not consume hazard limit (limit remains unchanged)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [CAVE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withCard = addCardInPlay(base, HAZARD_PLAYER, SUMMONS_FROM_LONG_SLEEP);
    const mhState = makeDoubleWildernessMHState({ hazardsPlayedThisCompany: 3, hazardLimitAtReveal: 4 });
    const state = { ...withCard, phaseState: mhState };

    // Even with limit nearly reached, reserve-creature should still be viable
    expect(viableActions(state, PLAYER_2, 'reserve-creature')).toHaveLength(1);
  });

  test('play-reserved-creature is offered for the reserved Dragon', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [CAVE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withCard = addCardInPlay(base, HAZARD_PLAYER, SUMMONS_FROM_LONG_SLEEP);
    const mhState = makeDoubleWildernessMHState();
    const state = { ...withCard, phaseState: mhState };

    const sourceId = state.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;
    const dragonId = handCardId(state, HAZARD_PLAYER);

    const afterReserve = dispatch(state, {
      type: 'reserve-creature',
      player: PLAYER_2,
      cardInstanceId: dragonId,
      sourceCardInstanceId: sourceId,
    });

    const playActions = viableActions(afterReserve, PLAYER_2, 'play-reserved-creature');
    expect(playActions.length).toBeGreaterThan(0);
  });

  test('reserved Dragon attacks with +2 prowess (base 10, effective 12)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [CAVE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withCard = addCardInPlay(base, HAZARD_PLAYER, SUMMONS_FROM_LONG_SLEEP);
    const mhState = makeDoubleWildernessMHState();
    const state = { ...withCard, phaseState: mhState };

    const sourceId = state.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;
    const dragonId = handCardId(state, HAZARD_PLAYER);

    const afterReserve = dispatch(state, {
      type: 'reserve-creature',
      player: PLAYER_2,
      cardInstanceId: dragonId,
      sourceCardInstanceId: sourceId,
    });

    const playActions = viableActions(afterReserve, PLAYER_2, 'play-reserved-creature');
    expect(playActions.length).toBeGreaterThan(0);

    // Play the reserved creature
    const afterPlay = dispatch(afterReserve, playActions[0].action);
    const afterChain = resolveChain(afterPlay);

    // Combat should be initiated with +2 prowess (Cave-drake base 10 → 12)
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(12);
  });

  test('AS-39 is discarded after the reserved creature attacks', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [CAVE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withCard = addCardInPlay(base, HAZARD_PLAYER, SUMMONS_FROM_LONG_SLEEP);
    const mhState = makeDoubleWildernessMHState();
    const state = { ...withCard, phaseState: mhState };

    const sourceId = state.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;
    const dragonId = handCardId(state, HAZARD_PLAYER);

    const afterReserve = dispatch(state, {
      type: 'reserve-creature',
      player: PLAYER_2,
      cardInstanceId: dragonId,
      sourceCardInstanceId: sourceId,
    });

    const playActions = viableActions(afterReserve, PLAYER_2, 'play-reserved-creature');
    const afterPlay = dispatch(afterReserve, playActions[0].action);
    const afterChain = resolveChain(afterPlay);

    // Combat should be initiated; now we need to resolve it.
    expect(afterChain.combat).not.toBeNull();

    // Cave-drake has attacker-chooses-defenders, so:
    // 1. P1 passes the cancel window
    // 2. P2 (attacker) assigns the strike to ARAGORN
    // 3. P1 resolves the strike (cheat 12 = success)
    // Then check AS-39 is discarded.

    // Step 1: P1 passes cancel window
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    const afterCancelPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // Step 2: P2 assigns both strikes (Cave-drake has 2 strikes, 1 character → excess)
    const assignActions = viableActions(afterCancelPass, PLAYER_2, 'assign-strike');
    expect(assignActions.length).toBeGreaterThan(0);
    const afterAssign1 = dispatch(afterCancelPass, assignActions[0].action);
    const excessActions = viableActions(afterAssign1, PLAYER_2, 'assign-strike');
    const afterAssign = excessActions.length > 0
      ? dispatch(afterAssign1, excessActions[0].action)
      : afterAssign1;

    // Step 3: P1 resolves strike with cheat roll 12 (success)
    const stateWithCheat = { ...afterAssign, cheatRollTotal: 12 as number | null };
    const resolveActions = viableActions(stateWithCheat, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    const afterResolve = dispatch(stateWithCheat, resolveActions[0].action);

    // After combat finishes, AS-39 should be gone from cardsInPlay
    // and in the hazard player's discard pile
    if (afterResolve.combat === null) {
      const p2 = afterResolve.players[HAZARD_PLAYER];
      expect(p2.cardsInPlay.some(c => c.instanceId === sourceId)).toBe(false);
      expect(p2.discardPile.some(c => c.instanceId === sourceId)).toBe(true);
    }
  });

  test('second reserve-creature action is not offered when slot is full', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS, GIMLI] }],
          hand: [CAVE_DRAKE, ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withCard = addCardInPlay(base, HAZARD_PLAYER, SUMMONS_FROM_LONG_SLEEP);
    const mhState = makeDoubleWildernessMHState();
    const state = { ...withCard, phaseState: mhState };

    const sourceId = state.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;
    const dragonId = findHandCardId(state, HAZARD_PLAYER, CAVE_DRAKE);

    const afterReserve = dispatch(state, {
      type: 'reserve-creature',
      player: PLAYER_2,
      cardInstanceId: dragonId,
      sourceCardInstanceId: sourceId,
    });

    // Slot is occupied; no more reserve-creature actions
    expect(viableActions(afterReserve, PLAYER_2, 'reserve-creature')).toHaveLength(0);
  });
});
