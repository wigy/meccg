/**
 * @module tw-100.test
 *
 * Card test: The Will of Sauron (tw-100)
 * Type: hazard-event (permanent), not unique
 *
 * Card text:
 *   "Playable if Doors of Night is in play. All hazard long-events remain in
 *    play until this card is discarded. Discard this card if Doors of Night is
 *    not in play, or when any play deck is exhausted. When this card is
 *    discarded, all hazard long events are discarded. Cannot be duplicated."
 *
 * Effects:
 * | # | Effect                                              | Status | Notes                                                       |
 * |---|-----------------------------------------------------|--------|-------------------------------------------------------------|
 * | 1 | play-condition requires:card-in-play Doors of Night | OK     | M/H long/permanent-event gate (Snowstorm tw-91 precedent)   |
 * | 2 | retain-hazard-long-events                           | OK     | suspends the [2.III.3] sweep; mass discard when it leaves   |
 * | 3 | discard-self-when $not inPlayAnywhere Doors of Night | OK     | postReduce sweep on the player-state context                |
 * | 4 | on-event play-deck-exhausted → discard-self          | OK     | completeDeckExhaust in reducer-utils                        |
 * | 5 | duplication-limit scope:game max:1                   | OK     | movement-hazard duplication check                           |
 *
 * Note: `inPlayAnywhere` (added for this card) is the game-wide in-play name
 * list, so an opponent's Doors of Night keeps The Will of Sauron alive just as
 * the controller's own copy does — matching "if Doors of Night is not in play".
 *
 * Playable: YES
 * CERTIFIED
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  DOORS_OF_NIGHT, EYE_OF_SAURON, GATES_OF_MORNING,
  Phase, CardStatus,
  buildTestState, resetMint,
  dispatch, viableActions, handCardId,
  playPermanentEventAndResolve,
  expectInDiscardPile, makeMHState,
  SAPLING_OF_THE_WHITE_TREE,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, EndOfTurnPhaseState } from '../../index.js';

const WILL_OF_SAURON = 'tw-100' as CardDefinitionId;

const willInPlay: CardInPlay = {
  instanceId: 'will-1' as CardInstanceId,
  definitionId: WILL_OF_SAURON,
  status: CardStatus.Untapped,
};

const doorsInPlay: CardInPlay = {
  instanceId: 'don-1' as CardInstanceId,
  definitionId: DOORS_OF_NIGHT,
  status: CardStatus.Untapped,
};

const eyeInPlay: CardInPlay = {
  instanceId: 'eye-1' as CardInstanceId,
  definitionId: EYE_OF_SAURON,
  status: CardStatus.Untapped,
};

describe('The Will of Sauron (tw-100)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable if Doors of Night is in play ───────────────────────────

  test('is playable as a hazard while Doors of Night is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILL_OF_SAURON], siteDeck: [MINAS_TIRITH], cardsInPlay: [doorsInPlay] },
      ],
    });
    const ready = { ...base, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('is not playable while no Doors of Night is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILL_OF_SAURON], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...base, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('an opponent\'s Doors of Night also satisfies the play condition', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], cardsInPlay: [doorsInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILL_OF_SAURON], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...base, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  // ── Rule 2: all hazard long-events remain in play ───────────────────────────

  test('hazard long-events survive the end of the long-event phase while it is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [doorsInPlay, willInPlay, eyeInPlay] },
      ],
    });

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(after.phaseState.phase).toBe(Phase.MovementHazard);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId))
      .toContain('eye-1' as CardInstanceId);
    expect(after.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId))
      .not.toContain('eye-1' as CardInstanceId);
  });

  test('without it in play the same hazard long-event is discarded as normal', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [doorsInPlay, eyeInPlay] },
      ],
    });

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(after.phaseState.phase).toBe(Phase.MovementHazard);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId))
      .not.toContain('eye-1' as CardInstanceId);
    expectInDiscardPile(after, HAZARD_PLAYER, EYE_OF_SAURON);
  });

  test('it survives the long-event phase itself (it is a permanent-event)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [doorsInPlay, willInPlay] },
      ],
    });

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(after.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId))
      .toContain('will-1' as CardInstanceId);
  });

  // ── Rule 3: discard this card if Doors of Night is not in play ──────────────

  test('stays in play while Doors of Night is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [doorsInPlay, willInPlay] },
      ],
    });

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(after.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId))
      .toContain('will-1' as CardInstanceId);
  });

  test('is discarded once Doors of Night is not in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [willInPlay] },
      ],
    });

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(after.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId))
      .not.toContain('will-1' as CardInstanceId);
    expectInDiscardPile(after, HAZARD_PLAYER, WILL_OF_SAURON);
  });

  // ── Rule 4: when discarded, all hazard long-events are discarded ────────────

  test('takes every hazard long-event with it when it is discarded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [willInPlay, eyeInPlay] },
      ],
    });

    // No Doors of Night in play → The Will of Sauron self-discards on the next
    // action, and the retained hazard long-event goes with it.
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expectInDiscardPile(after, HAZARD_PLAYER, WILL_OF_SAURON);
    expectInDiscardPile(after, HAZARD_PLAYER, EYE_OF_SAURON);
    expect(after.players[HAZARD_PLAYER].cardsInPlay).toHaveLength(0);
  });

  test('a hazard long-event in the resource player\'s play area is discarded too', () => {
    // "all hazard long events" is not scoped to the card's controller.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], cardsInPlay: [eyeInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [willInPlay] },
      ],
    });

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expectInDiscardPile(after, RESOURCE_PLAYER, EYE_OF_SAURON);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.instanceId))
      .not.toContain('eye-1' as CardInstanceId);
  });

  test('hazard long-events are untouched while it stays in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [doorsInPlay, willInPlay, eyeInPlay] },
      ],
    });

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(after.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId))
      .toEqual(expect.arrayContaining(['don-1', 'will-1', 'eye-1'] as CardInstanceId[]));
  });

  test('Gates of Morning cascades: Doors of Night → The Will of Sauron → hazard long-events', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [doorsInPlay, willInPlay, eyeInPlay] },
      ],
    });

    const gomId = handCardId(state, RESOURCE_PLAYER);
    const after = playPermanentEventAndResolve(state, PLAYER_1, gomId);

    // Gates of Morning discards the hazard environment (Doors of Night); the
    // Will of Sauron then self-discards, taking Eye of Sauron with it.
    expectInDiscardPile(after, HAZARD_PLAYER, DOORS_OF_NIGHT);
    expectInDiscardPile(after, HAZARD_PLAYER, WILL_OF_SAURON);
    expectInDiscardPile(after, HAZARD_PLAYER, EYE_OF_SAURON);
    expect(after.players[HAZARD_PLAYER].cardsInPlay).toHaveLength(0);
  });

  // ── Rule 5: discard when any play deck is exhausted ─────────────────────────

  test('discarded when a play deck is exhausted, taking hazard long-events with it', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [],
          discardPile: [SAPLING_OF_THE_WHITE_TREE],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [doorsInPlay, willInPlay, eyeInPlay] },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };

    // Before completion, both cards are still in play (Doors of Night keeps the
    // self-discard condition from firing).
    const afterExhaust = dispatch(resetHandState, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId))
      .toContain('will-1' as CardInstanceId);

    // Completing the exhaust fires play-deck-exhausted → discards The Will of
    // Sauron, whose departure discards the retained hazard long-event.
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId))
      .not.toContain('will-1' as CardInstanceId);
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId))
      .not.toContain('eye-1' as CardInstanceId);
    // Doors of Night has no such rule and stays in play.
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId))
      .toContain('don-1' as CardInstanceId);
  });

  // ── Rule 6: cannot be duplicated ────────────────────────────────────────────

  test('cannot be duplicated — not playable while a copy is already in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILL_OF_SAURON], siteDeck: [MINAS_TIRITH], cardsInPlay: [doorsInPlay, willInPlay] },
      ],
    });
    const ready = { ...base, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });
});
