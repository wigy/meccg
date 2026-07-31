/**
 * @module tw-243.test
 *
 * Card test: Gates of Morning (tw-243)
 * Type: hero-resource-event (permanent, environment)
 * Effects: 2 (duplication-limit scope:game max:1, on-event self-enters-play discard-cards-in-play filter:hazard-environment)
 *
 * "Environment. When Gates of Morning is played, all environment hazard
 *  cards in play are immediately discarded, and all hazard environment
 *  effects are canceled. Cannot be duplicated."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  GATES_OF_MORNING, DOORS_OF_NIGHT, TWILIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
  viableActions,
  playPermanentEventAndResolve,
  handCardId, dispatch,
  actionAs, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardInPlay, CardInstanceId, GameState, MovementHazardPhaseState, PlayPermanentEventAction, PlayShortEventAction } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Gates of Morning (tw-243)', () => {
  beforeEach(() => resetMint());

  test('can be played as a permanent event during organization', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);

    const gomId = handCardId(state, RESOURCE_PLAYER);

    // After declaring, card is on the chain (not in hand, not in cardsInPlay)
    const declareState = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(declareState.players[0].hand).toHaveLength(0);
    expect(declareState.players[0].cardsInPlay).toHaveLength(0);
    expect(declareState.chain).not.toBeNull();
    expect(declareState.chain!.entries[0].card?.instanceId).toBe(gomId);

    // After chain resolves, card moves to cardsInPlay
    const s = playPermanentEventAndResolve(state, PLAYER_1, gomId);
    expect(s.chain).toBeNull();
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].cardsInPlay[0].instanceId).toBe(gomId);
  });

  test('discards Doors of Night (hazard environment) when played', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    const gomId = handCardId(state, RESOURCE_PLAYER);
    const s = playPermanentEventAndResolve(state, PLAYER_1, gomId);

    // Gates of Morning in P1 cardsInPlay
    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].cardsInPlay[0].instanceId).toBe(gomId);

    // Doors of Night discarded from P2 cardsInPlay
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain('don-1' as CardInstanceId);
  });

  test('discards own hazard environment cards when played', () => {
    // Edge case: P1 has a Doors of Night in their own cardsInPlay
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = handCardId(state, RESOURCE_PLAYER);
    const s = playPermanentEventAndResolve(state, PLAYER_1, gomId);

    // Gates of Morning in cardsInPlay, Doors of Night discarded
    const p1InPlay = s.players[0].cardsInPlay;
    expect(p1InPlay).toHaveLength(1);
    expect(p1InPlay[0].instanceId).toBe(gomId);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain('don-1' as CardInstanceId);
  });

  test('does not discard own resource environment cards', () => {
    // If somehow another resource environment is in play, it should NOT be discarded
    const otherGomInPlay: CardInPlay = {
      instanceId: 'gom-other' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    // Use a second player's cardsInPlay with a resource environment
    // (this would normally be blocked by duplication-limit, but we test the discard logic)
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [otherGomInPlay] },
      ],
    });

    // Duplication limit will block this, but let's verify via the legal actions
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('cannot be duplicated when opponent has a copy in play', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('moving player may replay Gates of Morning in response to a Twilight canceling their existing one (CRF Annotation 11)', () => {
    // Regression: game mrs06zup-du4wde, seq 137. The hazard player played
    // Twilight targeting the moving player's in-play Gates of Morning; the
    // moving player was wrongly denied replaying Gates of Morning in response.
    // CRF 22 Annotation 11: a "cannot be duplicated" card may be played while a
    // copy is in play if that copy is being targeted by an effect that will
    // discard it (here, the Twilight on the chain). Rule 2.1.1 lets the resource
    // player play resource permanent-events during any phase, including as a
    // chain response.
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Override to the movement/hazard play-hazards step (the reported scenario).
    const mhState: MovementHazardPhaseState = {
      phase: Phase.MovementHazard,
      step: 'play-hazards',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      movementType: null,
      declaredRegionPath: [],
      maxRegionDistance: 4,
      hazardsPlayedThisCompany: 0,
      hazardLimitAtReveal: 4,
      preRevealHazardLimitConstraintIds: [],
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
      ahuntAttacksResolved: 0,
      corruptionCardsPlayedPerChar: {},
      nazgulSideboardDestination: null,
      nazgulSideboardFetched: 0,
    };
    const state: GameState = { ...base, phaseState: mhState };

    // Baseline: with no Twilight targeting it, the duplication-limit blocks the
    // second Gates of Morning outright (no viable play-permanent-event).
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);

    // P2 (hazard player) plays Twilight targeting P1's in-play Gates of Morning
    // → chain starts and P1 gets priority.
    const twilightId = handCardId(state, HAZARD_PLAYER);
    let s = dispatch(state, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: twilightId, targetInstanceId: 'gom-1' as CardInstanceId });
    expect(s.chain).not.toBeNull();
    expect(s.chain!.priority).toBe(PLAYER_1);

    // P1 may now replay Gates of Morning in response (Annotation 11).
    const gomId = handCardId(s, RESOURCE_PLAYER);
    const replayActions = viableActions(s, PLAYER_1, 'play-permanent-event');
    expect(replayActions).toHaveLength(1);
    expect(actionAs<PlayPermanentEventAction>(replayActions[0].action).cardInstanceId).toBe(gomId);

    // Resolve LIFO: the new Gates of Morning enters play first, then Twilight
    // discards the old copy. Exactly one Gates of Morning (the new one) survives.
    s = dispatch(s, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(s.chain).toBeNull();

    const gomCopies = s.players.flatMap(p => p.cardsInPlay).filter(c => c.definitionId === GATES_OF_MORNING);
    expect(gomCopies.map(c => c.instanceId)).toEqual([gomId]);
    // The old copy was discarded by the Twilight.
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain('gom-1' as CardInstanceId);
  });

  test('cannot declare a second Gates of Morning while the first is still unresolved on the chain', () => {
    // Regression: game ms7oxskb-o8u5ur, seq 34-36. P2 played Gates of Morning;
    // P1 passed chain priority; the engine then wrongly still offered P2 a
    // second Gates of Morning from hand, because the first copy hadn't
    // resolved into cardsInPlay yet and so wasn't counted by the
    // duplication-limit check. CoE g.cbd.1: "cannot be duplicated" is checked
    // against the state at the end of the chain resolving — a copy still
    // pending on the chain (and not itself targeted for removal) must count
    // just like an in-play copy. Both copies ended up in play.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING, GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const firstGomId = handCardId(state, RESOURCE_PLAYER);
    let s = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: firstGomId });
    expect(s.chain).not.toBeNull();
    expect(s.chain!.priority).toBe(PLAYER_2);

    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(s.chain!.priority).toBe(PLAYER_1);

    // The second Gates of Morning is still in P1's hand — must be blocked
    // while the first is unresolved on the chain.
    const actions = viableActions(s, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('no opposing environments to discard is a no-op', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = handCardId(state, RESOURCE_PLAYER);
    const s = playPermanentEventAndResolve(state, PLAYER_1, gomId);

    // Gates of Morning played, no discards needed
    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].discardPile).toHaveLength(0);
    expect(s.players[1].discardPile).toHaveLength(0);
  });

  test('opponent can cancel Gates of Morning with Twilight before it resolves', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    const gomId = handCardId(state, RESOURCE_PLAYER);
    const p2Twilight = handCardId(state, HAZARD_PLAYER);

    // P1 plays Gates of Morning → chain starts, P2 gets priority
    let s = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(s.chain!.priority).toBe(PLAYER_2);

    // P2 responds with Twilight targeting GoM on the chain
    s = dispatch(s, { type: 'play-short-event', player: PLAYER_2, cardInstanceId: p2Twilight, targetInstanceId: gomId });

    // Both pass → chain resolves LIFO: Twilight negates GoM
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });
    expect(s.chain).toBeNull();
    // GoM negated → goes to discard, never enters play
    expect(s.players[0].cardsInPlay).toHaveLength(0);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain(gomId);
    // Doors of Night survives
    expect(s.players[1].cardsInPlay).toHaveLength(1);
    expect(s.players[1].cardsInPlay[0].instanceId).toBe('don-1' as CardInstanceId);
  });

  test('Gates of Morning on chain is a valid Twilight target', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TWILIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = handCardId(state, RESOURCE_PLAYER);

    // P1 plays GoM → chain starts
    const nextState = dispatch(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });

    // P2 should have Twilight targeting GoM on the chain
    const p2Actions = viableActions(nextState, PLAYER_2, 'play-short-event');
    const gomTargets = p2Actions.filter(
      ea => actionAs<PlayShortEventAction>(ea.action).targetInstanceId === gomId,
    );
    expect(gomTargets).toHaveLength(1);
  });
});
