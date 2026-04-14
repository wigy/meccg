/**
 * @module tw-106.test
 *
 * Card test: Twilight (tw-106)
 * Type: hazard-event (short, environment)
 * Effects: 2 (play-restriction: playable-as-resource, play-restriction: no-hazard-limit)
 *
 * "Environment. One environment card (in play or declared earlier in the
 *  same chain of effects) is canceled and discarded. Twilight may also be
 *  played as a resource, may be played at any point during any player's turn
 *  and does not count against the hazard limit."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS,
  TWILIGHT, GATES_OF_MORNING, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
  viableActions,
  playShortEventAndResolve,
  handCardId,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardInPlay, CardInstanceId, GameState, MovementHazardPhaseState } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Twilight (tw-106)', () => {
  beforeEach(() => resetMint());

  test('cancels Gates of Morning (resource environment) in cardsInPlay', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const twilightId = handCardId(state, 0);
    const s = playShortEventAndResolve(state, PLAYER_1, twilightId, 'gom-1' as CardInstanceId);

    // Gates of Morning removed from cardsInPlay → discard
    expect(s.players[0].cardsInPlay).toHaveLength(0);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain('gom-1' as CardInstanceId);
    // Twilight also in discard
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain(twilightId);
    // Chain resolved and cleared
    expect(s.chain).toBeNull();
  });

  test('cancels opponent\'s environment in cardsInPlay', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
      ],
    });

    const twilightId = handCardId(state, 0);
    const s = playShortEventAndResolve(state, PLAYER_1, twilightId, 'gom-1' as CardInstanceId);

    // GoM removed from opponent's cardsInPlay → opponent's discard
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain('gom-1' as CardInstanceId);
    // Twilight in P1's discard
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain(twilightId);
  });

  test('not playable when no environment is in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const shortEventActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(shortEventActions).toHaveLength(0);

    // Should show as not-playable
    const notPlayable = computeLegalActions(state, PLAYER_1)
      .filter(ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId === state.players[0].hand[0].instanceId);
    expect(notPlayable).toHaveLength(1);
  });

  test('one action per environment target when multiple environments in play', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT], siteDeck: [MORIA], cardsInPlay: [gomInPlay, donInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const shortEventActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(shortEventActions).toHaveLength(2);

    const targets = shortEventActions.map(
      ea => (ea.action as { targetInstanceId: CardInstanceId }).targetInstanceId,
    );
    expect(targets).toContain('gom-1' as CardInstanceId);
    expect(targets).toContain('don-1' as CardInstanceId);
  });

  test('second Twilight can target first Twilight on the chain', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT, TWILIGHT], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const twilight1 = handCardId(state, 0, 0);
    const twilight2 = handCardId(state, 0, 1);

    // P1 plays Twilight #1 targeting Gates of Morning → chain starts
    let result = reduce(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: twilight1, targetInstanceId: 'gom-1' as CardInstanceId });
    expect(result.error).toBeUndefined();
    expect(result.state.chain).not.toBeNull();

    // P2 passes chain priority → priority back to P1
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(result.error).toBeUndefined();

    // P1 should have play-short-event actions targeting Twilight #1 on the chain
    const chainActions = viableActions(result.state, PLAYER_1, 'play-short-event');
    const twilight1AsTarget = chainActions.filter(
      ea => (ea.action as { targetInstanceId: CardInstanceId }).targetInstanceId === twilight1,
    );
    expect(twilight1AsTarget).toHaveLength(1);

    // P1 plays Twilight #2 targeting Twilight #1 on the chain
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: twilight2, targetInstanceId: twilight1 });
    expect(result.error).toBeUndefined();

    // Both pass → chain resolves LIFO: Twilight #2 negates Twilight #1, GoM survives
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const s = result.state;
    expect(s.chain).toBeNull();
    // Gates of Morning survived — still in cardsInPlay
    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].cardsInPlay[0].instanceId).toBe('gom-1' as CardInstanceId);
    // Both Twilights in discard
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain(twilight1);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain(twilight2);
  });

  test('opponent can respond with Twilight to cancel player\'s Twilight', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const p1Twilight = handCardId(state, 0);
    const p2Twilight = handCardId(state, 1);

    // P1 plays Twilight targeting Gates of Morning → chain starts, P2 gets priority
    let result = reduce(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: p1Twilight, targetInstanceId: 'gom-1' as CardInstanceId });
    expect(result.error).toBeUndefined();
    expect(result.state.chain!.priority).toBe(PLAYER_2);

    // P2 should see play-short-event targeting P1's Twilight on the chain
    const p2Actions = viableActions(result.state, PLAYER_2, 'play-short-event');
    const targetP1Twilight = p2Actions.filter(
      ea => (ea.action as { targetInstanceId: CardInstanceId }).targetInstanceId === p1Twilight,
    );
    expect(targetP1Twilight).toHaveLength(1);

    // P2 plays Twilight targeting P1's Twilight on the chain
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: p1Twilight });
    expect(result.error).toBeUndefined();

    // Both pass → chain resolves LIFO
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(result.error).toBeUndefined();

    const s = result.state;
    expect(s.chain).toBeNull();
    // Gates of Morning survived — P2's Twilight canceled P1's Twilight
    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].cardsInPlay[0].instanceId).toBe('gom-1' as CardInstanceId);
  });

  test('chain resolves after both players pass consecutively', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const twilightId = handCardId(state, 0);

    // P1 plays Twilight → chain starts, P2 has priority
    let result = reduce(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: twilightId, targetInstanceId: 'gom-1' as CardInstanceId });
    expect(result.error).toBeUndefined();
    expect(result.state.chain).not.toBeNull();
    expect(result.state.chain!.mode).toBe('declaring');
    expect(result.state.chain!.priority).toBe(PLAYER_2);

    // P2 passes → priority to P1
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(result.error).toBeUndefined();
    expect(result.state.chain!.priority).toBe(PLAYER_1);

    // P1 passes → both passed, chain resolves
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.chain).toBeNull();

    // GoM canceled and discarded
    expect(result.state.players[0].cardsInPlay).toHaveLength(0);
    expect(result.state.players[0].discardPile.map(c => c.instanceId)).toContain('gom-1' as CardInstanceId);
  });

  test('not playable during M/H phase when no environment in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Override to M/H play-hazards step
    const mhState: MovementHazardPhaseState = {
      phase: Phase.MovementHazard,
      step: 'play-hazards',
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
      resourceDrawMax: 0,
      hazardDrawMax: 0,
      resourceDrawCount: 0,
      hazardDrawCount: 0,
      resourcePlayerPassed: false,
      hazardPlayerPassed: false,
      onGuardPlacedThisCompany: false,
      siteRevealed: false,
      returnedToOrigin: false,
      hazardsEncountered: [],
    };
    const mhGameState: GameState = { ...state, phaseState: mhState };

    // Twilight should NOT appear as a viable play-short-event (no environment to target)
    const shortEventActions = viableActions(mhGameState, PLAYER_2, 'play-short-event');
    expect(shortEventActions).toHaveLength(0);

    // Should appear as non-viable with explanation
    const allActions = computeLegalActions(mhGameState, PLAYER_2);
    const twilightAction = allActions.find(
      ea => ea.action.type === 'play-hazard'
        && ea.action.cardInstanceId === mhGameState.players[1].hand[0].instanceId,
    );
    expect(twilightAction).toBeDefined();
    expect(twilightAction!.viable).toBe(false);
    expect(twilightAction!.reason).toContain('environment');
  });

  test('does not count against hazard limit (no-hazard-limit)', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Override to M/H play-hazards step with 1 hazard already played (limit 2)
    const mhState: MovementHazardPhaseState = {
      phase: Phase.MovementHazard,
      step: 'play-hazards',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      movementType: null,
      declaredRegionPath: [],
      maxRegionDistance: 4,
      hazardsPlayedThisCompany: 1,
      hazardLimit: 2,
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: null,
      destinationSiteName: null,
      resourceDrawMax: 0,
      hazardDrawMax: 0,
      resourceDrawCount: 0,
      hazardDrawCount: 0,
      resourcePlayerPassed: false,
      hazardPlayerPassed: false,
      onGuardPlacedThisCompany: false,
      siteRevealed: false,
      returnedToOrigin: false,
      hazardsEncountered: [],
    };
    const mhGameState: GameState = { ...state, phaseState: mhState };

    // P1 plays Twilight targeting GoM via play-short-event (as resource player response)
    const twilightId = handCardId(mhGameState, 0);
    const result = reduce(mhGameState, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: twilightId, targetInstanceId: 'gom-1' as CardInstanceId });
    expect(result.error).toBeUndefined();

    // Hazard count should NOT have incremented (Twilight has no-hazard-limit)
    const ps = result.state.phaseState as MovementHazardPhaseState;
    expect(ps.hazardsPlayedThisCompany).toBe(1);
  });

  test('second Twilight can also target Gates of Morning directly (first fizzles)', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT, TWILIGHT], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const twilight1 = handCardId(state, 0, 0);
    const twilight2 = handCardId(state, 0, 1);

    // P1 plays Twilight #1 targeting GoM
    let result = reduce(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: twilight1, targetInstanceId: 'gom-1' as CardInstanceId });
    expect(result.error).toBeUndefined();

    // P2 passes → P1 gets priority back
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(result.error).toBeUndefined();

    // P1 plays Twilight #2 also targeting GoM (both target the same environment)
    result = reduce(result.state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: twilight2, targetInstanceId: 'gom-1' as CardInstanceId });
    expect(result.error).toBeUndefined();

    // Both pass → chain resolves LIFO
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const s = result.state;
    expect(s.chain).toBeNull();
    // Twilight #2 resolves first → cancels GoM. Twilight #1 resolves second → fizzles (GoM already gone)
    expect(s.players[0].cardsInPlay).toHaveLength(0);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain('gom-1' as CardInstanceId);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain(twilight1);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain(twilight2);
  });
});
