/**
 * @module le-142.test
 *
 * Card test: Thrice Outnumbered (le-142)
 * Type: hazard-event (permanent)
 *
 * Card text:
 *   "Each player may take one Man hazard creature from his discard pile and
 *    shuffle it into his play deck at the end of each turn. Discard this card
 *    or a Man hazard creature from your hand at the end of opponent's
 *    long-event phase. Discard when any play deck is exhausted.
 *    Cannot be duplicated."
 *
 * Effects:
 *   1. duplication-limit scope:game max:1 — cannot be duplicated
 *   2. on-event: play-deck-exhausted — discard self when any deck exhausts
 *   3. on-event: end-of-turn, actor:both — each player may fetch Man creature
 *   4. event-maintenance: opponent-long-event-end — discard self or Man from hand
 *
 * | # | Effect                                          | Status | Notes                                      |
 * |---|-------------------------------------------------|--------|--------------------------------------------|
 * | 1 | duplication-limit (game, max 1)                 | OK     | movement-hazard.ts duplication check        |
 * | 2 | on-event: play-deck-exhausted, discard-self     | OK     | completeDeckExhaust in reducer-utils        |
 * | 3 | end-of-turn: each player fetches Man creature   | OK     | fireEndOfTurnFetchEffects in reducer-site   |
 * | 4 | maintenance: discard self or Man from hand      | OK     | event-maintenance pending resolution |
 *
 * Playable: YES
 * CERTIFIED
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  addCardInPlay,
  dispatch,
  dispatchResult,
  HAZARD_PLAYER, RESOURCE_PLAYER,
  expectInDiscardPile,
  SAPLING_OF_THE_WHITE_TREE,
  Phase,
  makeMHState,
  viableActions,
  makeSitePhase,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, EndOfTurnPhaseState } from '../../index.js';
import { CardStatus } from '../../index.js';

const THRICE_OUTNUMBERED = 'le-142' as CardDefinitionId;

const thriceInPlay: CardInPlay = {
  instanceId: 'thrice-1' as CardInstanceId,
  definitionId: THRICE_OUTNUMBERED,
  status: CardStatus.Untapped,
};

describe('Thrice Outnumbered (le-142)', () => {
  beforeEach(() => resetMint());

  test('cannot be duplicated — not playable when copy already in cardsInPlay', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THRICE_OUTNUMBERED],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [thriceInPlay],
        },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('can be played when no copy is already in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THRICE_OUTNUMBERED],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const allHazardActions = readyState.players[HAZARD_PLAYER].hand.map(h => h.instanceId);
    // The card in hand should appear as a viable play-hazard action
    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(allHazardActions.length).toBeGreaterThan(0);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('discards when active player deck exhausts during EOT', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [],
          discardPile: [SAPLING_OF_THE_WHITE_TREE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
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
    const withEvent = addCardInPlay(resetHandState, HAZARD_PLAYER, THRICE_OUTNUMBERED);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === THRICE_OUTNUMBERED,
    )).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });

    expectInDiscardPile(afterPass, HAZARD_PLAYER, THRICE_OUTNUMBERED);
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === THRICE_OUTNUMBERED,
    )).toBe(false);
  });

  // ---- Rule 3: end-of-turn fetch ----

  test('at EOT transition, both players get a pending fetch-to-deck effect for Man creatures', () => {
    // Man hazard creature: tw-8 (Ruffians)
    const MAN_CREATURE = 'tw-8' as CardDefinitionId;

    // Build a state in Site phase (play-resources step) with Thrice Outnumbered in HAZARD_PLAYER cardsInPlay
    // and a Man creature in each player's discard pile.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [MAN_CREATURE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          discardPile: [MAN_CREATURE],
        },
      ],
    });
    // Put Thrice Outnumbered in hazard player's cardsInPlay
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, THRICE_OUTNUMBERED);

    // Set phase state to play-resources (can pass to advance to EOT)
    const inSitePhase = {
      ...withEvent,
      phaseState: makeSitePhase({
        step: 'play-resources',
        handledCompanyIds: [],
        activeCompanyIndex: 0,
        siteEntered: true,
      }),
    };

    // Pass moves us to EOT and should fire fetch effects
    const afterPass = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });

    // Should have entered EOT phase
    expect(afterPass.phaseState.phase).toBe(Phase.EndOfTurn);

    // Both players should have a pending fetch effect queued
    expect(afterPass.pendingEffects.length).toBe(2);
    const actors = afterPass.pendingEffects.map(e => e.actor);
    expect(actors).toContain(PLAYER_1);
    expect(actors).toContain(PLAYER_2);

    // The effects should be fetch-to-deck for Man creatures
    for (const pe of afterPass.pendingEffects) {
      expect(pe.type).toBe('card-effect');
      if (pe.type === 'card-effect') {
        expect(pe.effect.type).toBe('fetch-to-deck');
        expect(pe.skipDiscard).toBe(true);
      }
    }
  });

  test('at EOT, resource player can fetch Man creature from discard pile', () => {
    const MAN_CREATURE = 'tw-8' as CardDefinitionId;

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [MAN_CREATURE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, THRICE_OUTNUMBERED);
    const inSitePhase = {
      ...withEvent,
      phaseState: makeSitePhase({
        step: 'play-resources',
        handledCompanyIds: [],
        activeCompanyIndex: 0,
        siteEntered: true,
      }),
    };

    // Transition to EOT — pending effects are queued
    const afterPass = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });

    // Find the pending effect for PLAYER_1 (resource player)
    const p1Effect = afterPass.pendingEffects.find(e => e.actor === PLAYER_1);
    expect(p1Effect).toBeDefined();

    // Get the instance ID of the Man creature in PLAYER_1's discard pile
    const manCreatureInstance = afterPass.players[RESOURCE_PLAYER].discardPile.find(
      c => c.definitionId === MAN_CREATURE,
    );
    expect(manCreatureInstance).toBeDefined();

    // PLAYER_1 fetches the Man creature from discard pile to deck
    const afterFetch = dispatch(afterPass, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: manCreatureInstance!.instanceId,
      source: 'discard-pile',
    });

    // The Man creature should now be in PLAYER_1's play deck
    const inDeck = afterFetch.players[RESOURCE_PLAYER].playDeck.some(
      c => c.definitionId === MAN_CREATURE,
    );
    expect(inDeck).toBe(true);

    // The Man creature should NOT be in PLAYER_1's discard pile any more
    const inDiscard = afterFetch.players[RESOURCE_PLAYER].discardPile.some(
      c => c.definitionId === MAN_CREATURE,
    );
    expect(inDiscard).toBe(false);
  });

  test('passing on fetch-to-deck emits a text-notification effect naming the card', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, THRICE_OUTNUMBERED);
    const inSitePhase = {
      ...withEvent,
      phaseState: makeSitePhase({
        step: 'play-resources',
        handledCompanyIds: [],
        activeCompanyIndex: 0,
        siteEntered: true,
      }),
    };

    // Transition to EOT — pending effects are queued
    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });
    expect(afterTransition.pendingEffects.length).toBe(2);

    // PLAYER_1 passes (skips fetch) — should emit a text-notification effect
    const result = dispatchResult(afterTransition, { type: 'pass', player: PLAYER_1 });
    expect(result.effects).toBeDefined();
    const notification = result.effects?.find(e => e.effect === 'text-notification');
    expect(notification).toBeDefined();
    if (notification && notification.effect === 'text-notification') {
      expect(notification.message).toContain('Thrice Outnumbered');
    }
  });

  test('at EOT, player can pass (skip fetch) if they have no Man creature in discard', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          // No Man creature in discard
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, THRICE_OUTNUMBERED);
    const inSitePhase = {
      ...withEvent,
      phaseState: makeSitePhase({
        step: 'play-resources',
        handledCompanyIds: [],
        activeCompanyIndex: 0,
        siteEntered: true,
      }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });
    expect(afterTransition.pendingEffects.length).toBe(2);

    // PLAYER_1 passes (skips fetch — no Man in discard)
    const afterPass1 = dispatch(afterTransition, { type: 'pass', player: PLAYER_1 });

    // One pending effect should remain (for PLAYER_2)
    expect(afterPass1.pendingEffects.length).toBe(1);
    expect(afterPass1.pendingEffects[0].actor).toBe(PLAYER_2);
  });

  // ---- Rule 4: event-maintenance ----

  test('at end of long-event phase, hazard player gets maintenance resolution', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, THRICE_OUTNUMBERED);

    // Active player (PLAYER_1) passes the long-event phase
    const afterPass = dispatch(withEvent, { type: 'pass', player: PLAYER_1 });

    // Hazard player should have a pending maintenance resolution
    const maintenanceRes = afterPass.pendingResolutions.find(
      r => r.kind.type === 'event-maintenance' && r.actor === PLAYER_2,
    );
    expect(maintenanceRes).toBeDefined();
  });

  test('hazard player can pay maintenance by discarding Thrice Outnumbered', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, THRICE_OUTNUMBERED);
    const thriceInstanceId = withEvent.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;

    const afterPass = dispatch(withEvent, { type: 'pass', player: PLAYER_1 });

    const maintenanceRes = afterPass.pendingResolutions.find(
      r => r.kind.type === 'event-maintenance',
    );
    expect(maintenanceRes).toBeDefined();

    // Pay by discarding the card itself
    const afterMaint = dispatch(afterPass, {
      type: 'pay-event-maintenance',
      player: PLAYER_2,
      paymentType: 'discard-self',
      cardInstanceId: thriceInstanceId,
      sourceInstanceId: thriceInstanceId,
    });

    // Thrice Outnumbered should now be in PLAYER_2's discard pile
    expectInDiscardPile(afterMaint, HAZARD_PLAYER, THRICE_OUTNUMBERED);
    expect(afterMaint.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === THRICE_OUTNUMBERED,
    )).toBe(false);

    // Maintenance resolution should be gone
    expect(afterMaint.pendingResolutions.filter(
      r => r.kind.type === 'event-maintenance',
    )).toHaveLength(0);
  });

  test('hazard player can pay maintenance by discarding a Man creature from hand', () => {
    const MAN_CREATURE = 'tw-8' as CardDefinitionId;

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [MAN_CREATURE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withEvent = addCardInPlay(base, HAZARD_PLAYER, THRICE_OUTNUMBERED);
    const thriceInstanceId = withEvent.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;

    const afterPass = dispatch(withEvent, { type: 'pass', player: PLAYER_1 });

    // The Man creature in hand should be offered as an alternative payment
    const manInHand = afterPass.players[HAZARD_PLAYER].hand.find(
      c => c.definitionId === MAN_CREATURE,
    );
    expect(manInHand).toBeDefined();

    // Pay by discarding the Man creature from hand
    const afterMaint = dispatch(afterPass, {
      type: 'pay-event-maintenance',
      player: PLAYER_2,
      paymentType: 'discard-from-hand',
      cardInstanceId: manInHand!.instanceId,
      sourceInstanceId: thriceInstanceId,
    });

    // Man creature should be in PLAYER_2's discard pile
    expectInDiscardPile(afterMaint, HAZARD_PLAYER, MAN_CREATURE);

    // Thrice Outnumbered should still be in play (not discarded)
    expect(afterMaint.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === THRICE_OUTNUMBERED,
    )).toBe(true);

    // Maintenance resolution should be gone
    expect(afterMaint.pendingResolutions.filter(
      r => r.kind.type === 'event-maintenance',
    )).toHaveLength(0);
  });

  test('discards when opponent (hazard player) deck exhausts during EOT', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: [],
          discardPile: [SAPLING_OF_THE_WHITE_TREE],
        },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [true, false] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withEvent = addCardInPlay(resetHandState, HAZARD_PLAYER, THRICE_OUTNUMBERED);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });

    expectInDiscardPile(afterPass, HAZARD_PLAYER, THRICE_OUTNUMBERED);
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === THRICE_OUTNUMBERED,
    )).toBe(false);
  });
});
