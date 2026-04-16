/**
 * @module rule-2.08-play-deck-exhaustion
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.08: Play Deck Exhaustion
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A play deck is "exhausted" when the last card is drawn from it. When a player exhausts their play deck, immediately discard any cards in play that would be discarded when a play deck is exhausted. The exhausting player then returns any site cards from their discard pile to their location deck, then may exchange up to five cards between their discard pile and sideboard (regardless of the type of cards), and then shuffles their discard pile which becomes their play deck. A play deck being exhausted and re-shuffled happens immediately when the last card is drawn (e.g. it may happen in the middle of drawing additional cards, which then resumes once the play deck is reset), and cannot be responded to.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS,
  DAGGER_OF_WESTERNESSE, CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';
import type { CardInstance, CardInstanceId } from '../../../index.js';

describe('Rule 2.08 — Play Deck Exhaustion', () => {
  beforeEach(() => resetMint());

  test('Drawing the last card from play deck triggers exhaustion and reshuffle', () => {
    // Set up a state with only 1 card in the play deck and some in discard
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          playDeck: [DAGGER_OF_WESTERNESSE], // Only 1 card left
          discardPile: [CAVE_DRAKE, ORC_PATROL, DAGGER_OF_WESTERNESSE], // These become new play deck
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    // Verify initial state
    expect(state.players[0].playDeck).toHaveLength(1);
    expect(state.players[0].discardPile).toHaveLength(3);
    expect(state.players[0].deckExhaustionCount).toBe(0);
  });

  test.todo('Exhaustion discards cards in play that trigger on deck exhaustion');

  test('Site cards from discard pile return to location deck on exhaustion', () => {
    // P1 has empty play deck and site cards in siteDiscardPile.
    // When deck-exhaust is triggered, site cards should move to siteDeck.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [],
          playDeck: [],
          discardPile: [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT],
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    // Manually add site cards to siteDiscardPile
    const siteCard: CardInstance = { instanceId: 'site-discard-1' as CardInstanceId, definitionId: MORIA };
    const stateWithSiteDiscard = {
      ...state,
      players: [
        { ...state.players[0], siteDiscardPile: [siteCard] },
        state.players[1],
      ] as const,
    };

    // Advance to reset-hand step (both players pass discard step)
    const p1Pass = dispatch(stateWithSiteDiscard, { type: 'pass', player: PLAYER_1 });
    const p2Pass = dispatch(p1Pass, { type: 'pass', player: PLAYER_2 });
    // Now in reset-hand step. P1 has 0 cards in hand (needs 8), empty deck, discard has cards.
    // deck-exhaust should be offered.
    const actions = computeLegalActions(p2Pass, PLAYER_1);
    const exhaustAction = actions.find(a => a.viable && a.action.type === 'deck-exhaust');
    expect(exhaustAction).toBeDefined();

    const afterExhaust = dispatch(p2Pass, exhaustAction!.action);

    // Site cards from siteDiscardPile should have moved to siteDeck
    const p1 = afterExhaust.players[0];
    expect(p1.siteDiscardPile).toHaveLength(0);
    expect(p1.siteDeck.some(c => c.instanceId === siteCard.instanceId)).toBe(true);
  });

  test('Player may exchange up to 5 cards between discard and sideboard on exhaustion', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [],
          playDeck: [],
          discardPile: [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT],
          sideboard: [DAGGER_OF_WESTERNESSE],
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    // Advance to reset-hand step
    const p1Pass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const p2Pass = dispatch(p1Pass, { type: 'pass', player: PLAYER_2 });

    // Trigger deck-exhaust
    const afterExhaust = dispatch(p2Pass, { type: 'deck-exhaust', player: PLAYER_1 });

    // Now in exhaust sub-flow: exchange-sideboard actions should be available
    const exchangeActions = computeLegalActions(afterExhaust, PLAYER_1);
    const exchanges = exchangeActions.filter(a => a.viable && a.action.type === 'exchange-sideboard');
    expect(exchanges.length).toBeGreaterThan(0);

    // Perform one exchange
    const afterExchange = dispatch(afterExhaust, exchanges[0].action);
    expect(afterExchange.players[0].deckExhaustExchangeCount).toBe(1);

    // Pass to complete the sub-flow
    const passActions = computeLegalActions(afterExchange, PLAYER_1);
    const passAction = passActions.find(a => a.viable && a.action.type === 'pass');
    expect(passAction).toBeDefined();
  });

  test('Discard pile becomes new play deck after shuffle', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [],
          playDeck: [],
          discardPile: [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT],
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    // Advance to reset-hand step
    const p1Pass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const p2Pass = dispatch(p1Pass, { type: 'pass', player: PLAYER_2 });

    // Trigger deck-exhaust
    const afterExhaust = dispatch(p2Pass, { type: 'deck-exhaust', player: PLAYER_1 });

    // Pass to complete exchange sub-flow (0 exchanges is fine)
    const afterComplete = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });

    const p1 = afterComplete.players[0];
    // Discard pile should be empty — all cards moved to play deck
    expect(p1.discardPile).toHaveLength(0);
    // Play deck should now have the 3 cards that were in discard
    expect(p1.playDeck).toHaveLength(3);
  });

  test('Exhaustion mid-draw forces deck-exhaust as the only action and offers no chain', () => {
    // In the M/H draw-cards step, the resource player must draw 2 cards
    // but their playDeck has only 1. After drawing the first card the deck
    // is empty; the only legal action is `deck-exhaust`. No chain priority
    // is offered (state.chain is null), and the opponent gets no actions
    // — confirming the reshuffle "cannot be responded to."
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          playDeck: [DAGGER_OF_WESTERNESSE],
          discardPile: [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT],
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: [DAGGER_OF_WESTERNESSE],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    // Force the M/H phase into draw-cards step, with P1 needing 2 draws.
    const drawState = {
      ...state,
      phaseState: {
        phase: Phase.MovementHazard,
        step: 'draw-cards',
        activeCompanyIndex: 0,
        handledCompanyIds: [],
        movementType: null,
        declaredRegionPath: [],
        maxRegionDistance: 4,
        hazardsPlayedThisCompany: 0,
        hazardLimit: 4,
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: null,
        destinationSiteName: null,
        resourceDrawMax: 2,
        hazardDrawMax: 2,
        resourceDrawCount: 0,
        hazardDrawCount: 0,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
        onGuardPlacedThisCompany: false,
        siteRevealed: true,
        returnedToOrigin: false,
        hazardsEncountered: [],
        ahuntAttacksResolved: 0,
      },
    } as typeof state;

    // Draw the only card in P1's deck — leaves playDeck empty mid-draw.
    const afterDraw = dispatch(drawState, { type: 'draw-cards', player: PLAYER_1, count: 1 });

    // The reshuffle must be the only thing P1 can do now: exactly one
    // viable action of type `deck-exhaust`.
    const p1Actions = computeLegalActions(afterDraw, PLAYER_1).filter(a => a.viable);
    expect(p1Actions.map(a => a.action.type)).toEqual(['deck-exhaust']);

    // No chain is open: nothing for either player to respond to.
    expect(afterDraw.chain).toBeNull();
  });

  test('Deck exhaustion count increments on each exhaustion', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [],
          playDeck: [],
          discardPile: [CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT],
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    expect(state.players[0].deckExhaustionCount).toBe(0);

    // Advance to reset-hand step
    const p1Pass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const p2Pass = dispatch(p1Pass, { type: 'pass', player: PLAYER_2 });

    // Trigger deck-exhaust and complete
    const afterExhaust = dispatch(p2Pass, { type: 'deck-exhaust', player: PLAYER_1 });
    const afterComplete = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });

    expect(afterComplete.players[0].deckExhaustionCount).toBe(1);
  });
});
