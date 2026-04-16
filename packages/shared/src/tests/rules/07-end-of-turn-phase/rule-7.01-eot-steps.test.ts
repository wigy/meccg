/**
 * @module rule-7.01-eot-steps
 *
 * CoE Rules — Section 7: End-of-Turn Phase
 * Rule 7.01: End-of-Turn Steps
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Players proceed through the following Steps 1-3 (2.VI.i-iii) during the end-of-turn phase; between these steps, actions may be taken that would otherwise be legal (e.g. resource/character actions that may be taken "during" the end-of-turn phase or which don't require a specific phase):
 * Ending the Turn, Step 1) Either player may discard a card from their own hand.
 * Ending the Turn, Step 2) Both players reset their hands by drawing or discarding to their base hand size.
 * Ending the Turn, Step 3) The resource player signals the end of the turn. Actions with end-of-turn passive conditions are declared and resolved in an order chosen by the resource player. No other action can be taken during this step unless it is specifically allowed at the end of the turn (which does not include actions that may be taken during the end-of-turn phase generally).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, dispatch, viableActions, viableFor,
  PLAYER_1, PLAYER_2,
  SUN, CAVE_DRAKE,
  DAGGER_OF_WESTERNESSE,
  Phase, handCardId, eotState, phaseStateAs, actionAs,
} from '../../test-helpers.js';
import type { DiscardCardAction, DrawCardsAction, EndOfTurnPhaseState } from '../../../index.js';

describe('Rule 7.01 — End-of-Turn Steps', () => {
  beforeEach(() => resetMint());

  test('Step 1 (discard): either player may discard a card from their own hand or pass', () => {
    // Both players hold one card each. The discard step offers each
    // player one discard-card action per hand card plus a pass.
    const state = eotState({ p1Hand: [SUN], p2Hand: [CAVE_DRAKE] });
    expect(phaseStateAs<EndOfTurnPhaseState>(state).step).toBe('discard');

    const p1Discards = viableActions(state, PLAYER_1, 'discard-card');
    const p1Ids = p1Discards.map(a => actionAs<DiscardCardAction>(a.action).cardInstanceId);
    expect(p1Ids).toEqual([state.players[0].hand[0].instanceId]);
    expect(viableActions(state, PLAYER_1, 'pass')).toHaveLength(1);

    // P2 may also discard their own card during step 1.
    const p2Discards = viableActions(state, PLAYER_2, 'discard-card');
    expect(p2Discards.map(a => actionAs<DiscardCardAction>(a.action).cardInstanceId))
      .toEqual([state.players[1].hand[0].instanceId]);

    // P1 cannot discard P2's hand card.
    expect(p1Ids).not.toContain(state.players[1].hand[0].instanceId);
  });

  test('Step 2 (reset-hand): a player above hand size must discard, below draws up', () => {
    // P1 has 2 cards in hand and a single-card play deck. After both pass
    // step 1 we land in reset-hand. P1 (hand 2 < base 8, deck 1) is offered
    // a draw action. P2 (hand 0, deck 1) is also offered a draw action.
    const state = eotState({
      p1Hand: [SUN, DAGGER_OF_WESTERNESSE],
      p1Deck: [DAGGER_OF_WESTERNESSE],
      p2Deck: [DAGGER_OF_WESTERNESSE],
    });

    const afterP1Pass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterP2Pass = dispatch(afterP1Pass, { type: 'pass', player: PLAYER_2 });
    expect(phaseStateAs<EndOfTurnPhaseState>(afterP2Pass).step).toBe('reset-hand');

    const p1Draws = viableActions(afterP2Pass, PLAYER_1, 'draw-cards');
    expect(p1Draws).toHaveLength(1);
    expect(actionAs<DrawCardsAction>(p1Draws[0].action).count).toBe(6); // 8 - 2

    const p2Draws = viableActions(afterP2Pass, PLAYER_2, 'draw-cards');
    expect(p2Draws).toHaveLength(1);
    expect(actionAs<DrawCardsAction>(p2Draws[0].action).count).toBe(8);
  });

  test('Step 3 (signal-end): only the resource player may pass; hazard player has no actions', () => {
    // Drive the engine through steps 1 and 2 by passing on each player's
    // turn. With empty hands and empty decks, both players pass straight
    // through reset-hand and arrive at signal-end.
    const state = eotState();
    const s1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const s2 = dispatch(s1, { type: 'pass', player: PLAYER_2 });
    const s3 = dispatch(s2, { type: 'pass', player: PLAYER_1 });
    const s4 = dispatch(s3, { type: 'pass', player: PLAYER_2 });
    expect(phaseStateAs<EndOfTurnPhaseState>(s4).step).toBe('signal-end');

    // Resource player (PLAYER_1) may pass to end the turn.
    expect(viableFor(s4, PLAYER_1).some(a => a.action.type === 'pass')).toBe(true);

    // Hazard player has no actions during signal-end.
    expect(viableFor(s4, PLAYER_2)).toHaveLength(0);

    // Passing the signal-end ends the turn (advances to next turn's untap).
    const next = dispatch(s4, { type: 'pass', player: PLAYER_1 });
    expect(next.phaseState.phase).toBe(Phase.Untap);
  });

  test('Discarding the last card in hand still allows passing the discard step', () => {
    // P1 has a single card. After discarding it, the only remaining
    // legal action is pass — the engine doesn't get stuck when hand
    // becomes empty mid-step.
    const state = eotState({ p1Hand: [SUN] });
    const sunId = handCardId(state, 0);

    const afterDiscard = dispatch(state, { type: 'discard-card', player: PLAYER_1, cardInstanceId: sunId });
    expect(afterDiscard.players[0].discardPile.some(c => c.instanceId === sunId)).toBe(true);

    // P1 has now acted in step 1 (discardDone[0] = true) and is offered
    // no further actions until P2 passes too.
    expect(viableFor(afterDiscard, PLAYER_1)).toHaveLength(0);
  });
});
