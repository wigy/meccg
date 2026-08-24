/**
 * @module dm-159.test
 *
 * Card test: Smoke Rings (dm-159)
 * Type: hero-resource-event (short)
 * Effects: 1 (fetch-to-deck from sideboard/discard-pile)
 *
 * "Bring one resource or character from your sideboard or discard pile
 *  into your play deck and shuffle."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, SMOKE_RINGS,
  GLAMDRING, STING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, actionAs, makeMHState,
  handCardId, dispatch, resolveChain, companyIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType, Alignment } from '../../index.js';
import type { FetchFromPileAction, CardDefinitionId } from '../../index.js';

// Cave Worm (le-65): a region-keyed creature hazard used to open combat as the
// chain collapses. Region-name keyable to Angmar (see le-65.test.ts).
const CAVE_WORM = 'le-65' as CardDefinitionId;

// Wild Hounds (wh-40): a minion-resource-faction, dual-alignment card. Legal
// in a Fallen-wizard's deck alongside hero resources (CoE 1.3.F1/F4).
const WILD_HOUNDS = 'wh-40' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Smoke Rings (dm-159)', () => {
  beforeEach(() => resetMint());

  test('appears as playable resource short-event in long-event phase', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    expect(playActions[0].action.type).toBe('play-short-event');
  });

  // Regression (game mqs3008i-sexowp, seq 94, bug-report 9474aaebe1f02b18):
  // Smoke Rings was resolving immediately on play, skipping the chain of
  // effects — the opponent never got a window to respond. Per CRF 22 (which
  // errata the word "immediately" out of the card) and CoE 9.4/9.5, the play
  // must be declared on the chain like any other short event.
  test('playing Smoke Rings initiates a chain so the opponent can respond', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const afterPlay = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId });

    // A chain is now active, carrying Smoke Rings — it has NOT resolved yet.
    expect(afterPlay.chain).not.toBeNull();
    expect(afterPlay.players[0].hand).toHaveLength(0);
    expect(afterPlay.pendingEffects).toHaveLength(0);

    // The opponent holds priority and may respond before the fetch resolves.
    const opponentActions = computeLegalActions(afterPlay, PLAYER_2);
    expect(opponentActions.some(ea => ea.action.type === 'pass-chain-priority')).toBe(true);
  });

  test('after both players pass priority, Smoke Rings enters the fetch sub-flow', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const afterPlay = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId });
    const next = resolveChain(afterPlay);

    // Chain resolved; Smoke Rings is in cardsInPlay while the effect resolves
    expect(next.chain).toBeNull();
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].cardsInPlay.map(c => c.instanceId)).toContain(smokeRingsId);
    expect(next.players[0].discardPile.map(c => c.instanceId)).not.toContain(smokeRingsId);

    // Effect sub-flow is active with fetch-to-deck effect
    expect(next.pendingEffects).toHaveLength(1);
    expect(next.pendingEffects[0].type).toBe('card-effect');
    expect(next.pendingEffects[0].effect.type).toBe('fetch-to-deck');
    expect(next.pendingEffects[0].cardInstanceId).toBe(smokeRingsId);
  });

  test('fetch sub-flow shows eligible cards from sideboard', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING, STING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Play Smoke Rings and resolve the chain into the fetch sub-flow
    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const next = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // Fetch actions: 2 sideboard cards (Smoke Rings is in cardsInPlay, not in any player pile)
    const fetchActions = viableActions(next, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(2);
    const sideboardFetches = fetchActions.filter(
      ea => actionAs<FetchFromPileAction>(ea.action).source === 'sideboard',
    );
    expect(sideboardFetches).toHaveLength(2);
  });

  test('fetch sub-flow shows eligible cards from discard pile', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], discardPile: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Play Smoke Rings and resolve the chain into the fetch sub-flow
    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const next = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // Fetch actions: Glamdring from discard pile (Smoke Rings is in cardsInPlay)
    const fetchActions = viableActions(next, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);
    expect(actionAs<FetchFromPileAction>(fetchActions[0].action).source).toBe('discard-pile');
  });

  test('fetching a card from sideboard adds it to play deck and shuffles', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const glamdringId = state.players[0].sideboard[0].instanceId;
    const originalDeckSize = state.players[0].playDeck.length;

    // Play Smoke Rings and resolve the chain into the fetch sub-flow
    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // Fetch Glamdring from sideboard
    const afterFetch = dispatch(afterPlay, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: glamdringId,
      source: 'sideboard',
    });

    // Glamdring is now in the play deck
    expect(afterFetch.players[0].playDeck.length).toBe(originalDeckSize + 1);
    expect(afterFetch.players[0].playDeck.map(c => c.instanceId)).toContain(glamdringId);

    // Sideboard no longer contains Glamdring
    expect(afterFetch.players[0].sideboard).toHaveLength(0);

    // Smoke Rings moved from cardsInPlay to discard after fetch resolved
    expect(afterFetch.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(smokeRingsId);
    expect(afterFetch.players[0].discardPile.map(c => c.instanceId)).toContain(smokeRingsId);

    // Effect sub-flow is cleared
    expect(afterFetch.pendingEffects).toHaveLength(0);
  });

  test('fetching a card from discard pile adds it to play deck and shuffles', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], discardPile: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const glamdringId = state.players[0].discardPile[0].instanceId;
    const originalDeckSize = state.players[0].playDeck.length;

    // Play Smoke Rings and resolve the chain into the fetch sub-flow
    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // Fetch Glamdring from discard pile
    const afterFetch = dispatch(afterPlay, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: glamdringId,
      source: 'discard-pile',
    });

    // Glamdring moved from discard to play deck
    expect(afterFetch.players[0].playDeck.length).toBe(originalDeckSize + 1);
    expect(afterFetch.players[0].playDeck.map(c => c.instanceId)).toContain(glamdringId);

    // Discard pile contains Smoke Rings (moved from cardsInPlay after fetch resolved)
    // Glamdring was moved to play deck
    expect(afterFetch.players[0].discardPile.map(c => c.instanceId)).toContain(smokeRingsId);
    expect(afterFetch.players[0].discardPile.map(c => c.instanceId)).not.toContain(glamdringId);
    expect(afterFetch.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(smokeRingsId);

    // Fetch sub-flow is cleared
    expect(afterFetch.pendingEffects).toHaveLength(0);
  });

  test('pass during fetch sub-flow skips the fetch', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);

    // Play Smoke Rings and resolve the chain into the fetch sub-flow
    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // Pass to skip fetch
    const afterPass = dispatch(afterPlay, { type: 'pass', player: PLAYER_1 });

    // Fetch sub-flow cleared, still in long-event phase
    expect(afterPass.phaseState.phase).toBe(Phase.LongEvent);
    expect(afterPass.pendingEffects).toHaveLength(0);

    // Sideboard unchanged
    expect(afterPass.players[0].sideboard).toHaveLength(1);

    // Smoke Rings moved from cardsInPlay to discard after pass
    expect(afterPass.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(smokeRingsId);
    expect(afterPass.players[0].discardPile.map(c => c.instanceId)).toContain(smokeRingsId);
  });

  test('non-resource/character cards in sideboard are not eligible for fetch', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);

    // Play Smoke Rings and resolve the chain into the fetch sub-flow
    const next = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // No eligible cards: MORIA (site) doesn't match filter, Smoke Rings is in cardsInPlay
    const fetchActions = viableActions(next, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(0);

    // Pass is still available
    const passActions = viableActions(next, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // Regression (game msyowa12-x5dnmx, seq 1271, bug-report bd8a574a2c3ce39f):
  // a Fallen-wizard player's discard pile legitimately holds minion-typed
  // resource cards alongside hero-typed ones (CoE 1.3.F1/F4), but Smoke
  // Rings' fetch filter only listed hero-* cardTypes, so a Fallen-wizard's
  // own minion-resource-faction card (Wild Hounds) was silently excluded
  // from the fetch sub-flow even though it sat right there in the discard.
  test('a Fallen-wizard can fetch their own minion-typed resource from the discard pile', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [SMOKE_RINGS],
          siteDeck: [MORIA],
          discardPile: [WILD_HOUNDS],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const wildHoundsId = state.players[0].discardPile[0].instanceId;

    // Play Smoke Rings and resolve the chain into the fetch sub-flow
    const next = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // Wild Hounds (minion-resource-faction) is offered even though Smoke
    // Rings' filter is written for hero-* cardTypes.
    const fetchActions = viableActions(next, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions.some(
      ea => actionAs<FetchFromPileAction>(ea.action).cardInstanceId === wildHoundsId,
    )).toBe(true);

    const afterFetch = dispatch(next, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: wildHoundsId,
      source: 'discard-pile',
    });
    expect(afterFetch.players[0].playDeck.map(c => c.instanceId)).toContain(wildHoundsId);
    expect(afterFetch.players[0].discardPile.map(c => c.instanceId)).not.toContain(wildHoundsId);
  });

  test('opponent has no actions during fetch sub-flow', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const next = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));

    // Once the chain has resolved and the fetch sub-flow is the active player's,
    // the opponent has no actions (the response window was during the chain).
    const opponentActions = computeLegalActions(next, PLAYER_2);
    expect(opponentActions).toHaveLength(0);
  });

  // Regression (game mrs06zup-du4wde, seq 128, bug-report b315a31aefcc7d84):
  // Smoke Rings "disappeared without effect". A creature hazard (bottom of the
  // chain) and Smoke Rings (top of the chain) collapsed in the same step, which
  // queued the fetch-to-deck pending effect AND started the creature's combat.
  // Combat took precedence, deferring the fetch; when the M/H phase resumed, a
  // routine `pass` was routed to the deferred fetch and silently skipped it —
  // the player never got to bring a card into the deck. The event card went to
  // discard with no effect. The fix resolves the pending fetch (higher chain
  // entry, LIFO) BEFORE combat actions become legal.
  test('fetch is presented before combat when a creature attack collapses on the same chain', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MINAS_TIRITH], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_WORM], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Angmar'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Some Lair',
      }),
    };

    const wormId = handCardId(ready, HAZARD_PLAYER);
    const smokeRingsId = handCardId(ready, RESOURCE_PLAYER);
    const glamdringId = ready.players[0].sideboard[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // P2 declares the creature attack — the chain opens but does not resolve.
    const afterCreature = dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: wormId,
      targetCompanyId: companyId, keyedBy: { method: 'region-name', value: 'Angmar' },
    });
    expect(afterCreature.chain).not.toBeNull();

    // P1 responds with Smoke Rings on the same chain (declared above the creature).
    const afterSmoke = dispatch(afterCreature, {
      type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId,
    });

    // Both players pass priority → the chain collapses: Smoke Rings' fetch is
    // queued AND the creature's combat begins in the same step.
    const collapsed = resolveChain(afterSmoke);
    expect(collapsed.combat).not.toBeNull();
    expect(collapsed.pendingEffects).toHaveLength(1);
    expect(collapsed.pendingEffects[0].effect.type).toBe('fetch-to-deck');

    // Fix: P1's legal actions are the fetch (not combat) — the higher chain
    // entry resolves first. Before the fix, combat actions were offered and the
    // pending fetch was deferred and later lost.
    const p1Actions = computeLegalActions(collapsed, PLAYER_1);
    expect(p1Actions.some(ea => ea.action.type === 'fetch-from-pile')).toBe(true);
    expect(p1Actions.every(ea => ea.action.type === 'fetch-from-pile' || ea.action.type === 'pass')).toBe(true);

    // Resolving the fetch brings the chosen card into the deck; the fetch is
    // NOT skipped, and combat then proceeds normally.
    const afterFetch = dispatch(collapsed, {
      type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: glamdringId, source: 'sideboard',
    });
    expect(afterFetch.players[0].playDeck.map(c => c.instanceId)).toContain(glamdringId);
    expect(afterFetch.players[0].sideboard).toHaveLength(0);
    expect(afterFetch.pendingEffects).toHaveLength(0);
    expect(afterFetch.combat).not.toBeNull();
  });

  test('after fetch completes, normal long-event actions resume', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SMOKE_RINGS], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const smokeRingsId = handCardId(state, RESOURCE_PLAYER);
    const glamdringId = state.players[0].sideboard[0].instanceId;

    // Play Smoke Rings, resolve the chain, then fetch
    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: smokeRingsId }));
    const afterFetch = dispatch(afterPlay, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: glamdringId,
      source: 'sideboard',
    });

    // Still in long-event phase, pass is available
    const passActions = viableActions(afterFetch, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);

    // Can pass to advance to M/H phase
    const afterPass = dispatch(afterFetch, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.phaseState.phase).toBe(Phase.MovementHazard);
  });
});
