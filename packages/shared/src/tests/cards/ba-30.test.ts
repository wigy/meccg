/**
 * @module ba-30.test
 *
 * Card test: Longbottom Leaf (ba-30)
 * Type: hero-resource-event (short)
 * Effects: 1 (fetch-to-deck from sideboard, count 2, removeFromGame)
 *
 * "Take up to two resources from your sideboard to your play deck and
 *  reshuffle. Remove this card from the game."
 *
 * Longbottom Leaf is a sideboard-only fetch short-event. Unlike Smoke Rings
 * (dm-159) it (a) fetches *up to two* cards, (b) draws only from the sideboard
 * (never the discard pile), (c) accepts only resources — never characters —
 * and (d) removes itself from the game (to the out-of-play pile) instead of
 * discarding once the fetch resolves.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  GLAMDRING, STING, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, actionAs,
  handCardId, dispatch, resolveChain, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardDefinitionId, FetchFromPileAction } from '../../index.js';

const LONGBOTTOM_LEAF = 'ba-30' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Longbottom Leaf (ba-30)', () => {
  beforeEach(() => resetMint());

  test('appears as playable resource short-event in long-event phase', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LONGBOTTOM_LEAF], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    expect(playActions[0].action.type).toBe('play-short-event');
  });

  test('playing Longbottom Leaf initiates a chain so the opponent can respond', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LONGBOTTOM_LEAF], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const leafId = handCardId(state, RESOURCE_PLAYER);
    const afterPlay = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: leafId });

    // The card is on the chain — not yet resolved.
    expect(afterPlay.chain).not.toBeNull();
    expect(afterPlay.players[0].hand).toHaveLength(0);
    expect(afterPlay.pendingEffects).toHaveLength(0);

    // The opponent holds priority and may respond before the fetch resolves.
    const opponentActions = computeLegalActions(afterPlay, PLAYER_2);
    expect(opponentActions.some(ea => ea.action.type === 'pass-chain-priority')).toBe(true);
  });

  test('after chain resolves, the fetch sub-flow is active for count-2 sideboard fetch', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LONGBOTTOM_LEAF], siteDeck: [MORIA], sideboard: [GLAMDRING, STING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const leafId = handCardId(state, RESOURCE_PLAYER);
    const next = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: leafId }));

    // Card sits in cardsInPlay while the fetch resolves.
    expect(next.chain).toBeNull();
    expect(next.players[0].cardsInPlay.map(c => c.instanceId)).toContain(leafId);

    // A single fetch-to-deck pending effect with count 2.
    expect(next.pendingEffects).toHaveLength(1);
    expect(next.pendingEffects[0].type).toBe('card-effect');
    const eff = next.pendingEffects[0];
    expect(eff.type === 'card-effect' && eff.effect.type === 'fetch-to-deck' && eff.effect.count).toBe(2);
  });

  test('only sideboard resources are eligible — discard-pile cards and characters are not', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [LONGBOTTOM_LEAF],
          siteDeck: [MORIA],
          // GLAMDRING + STING are resources (eligible); GIMLI is a character
          // (excluded); MORIA is a site (excluded).
          sideboard: [GLAMDRING, STING, GIMLI, MORIA],
          // A resource in the discard pile must NOT be reachable (sideboard-only).
          discardPile: [DAGGER_OF_WESTERNESSE],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const leafId = handCardId(state, RESOURCE_PLAYER);
    const next = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: leafId }));

    const fetchActions = viableActions(next, PLAYER_1, 'fetch-from-pile');
    // Exactly the two sideboard resources — Gimli (character), Moria (site),
    // and the discard-pile dagger are all excluded.
    expect(fetchActions).toHaveLength(2);
    expect(fetchActions.every(ea => actionAs<FetchFromPileAction>(ea.action).source === 'sideboard')).toBe(true);
    const fetchedDefs = fetchActions
      .map(ea => next.players[0].sideboard.find(c => c.instanceId === actionAs<FetchFromPileAction>(ea.action).cardInstanceId)?.definitionId);
    expect(fetchedDefs).toContain(GLAMDRING);
    expect(fetchedDefs).toContain(STING);
    expect(fetchedDefs).not.toContain(GIMLI);
  });

  test('fetching two resources moves both into the play deck and removes the leaf from the game', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LONGBOTTOM_LEAF], siteDeck: [MORIA], sideboard: [GLAMDRING, STING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const leafId = handCardId(state, RESOURCE_PLAYER);
    const glamdringId = state.players[0].sideboard[0].instanceId;
    const stingId = state.players[0].sideboard[1].instanceId;
    const originalDeckSize = state.players[0].playDeck.length;

    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: leafId }));

    // First pick.
    const afterFirst = dispatch(afterPlay, { type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: glamdringId, source: 'sideboard' });
    // Sub-flow persists — a second pick is still offered (count 2).
    expect(afterFirst.pendingEffects).toHaveLength(1);
    const midEff = afterFirst.pendingEffects[0];
    expect(midEff.type === 'card-effect' && midEff.effect.type === 'fetch-to-deck' && midEff.effect.count).toBe(1);
    // Leaf still on the table between picks.
    expect(afterFirst.players[0].cardsInPlay.map(c => c.instanceId)).toContain(leafId);

    // Second pick.
    const afterSecond = dispatch(afterFirst, { type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: stingId, source: 'sideboard' });

    // Both resources are now in the play deck; sideboard is empty.
    expect(afterSecond.players[0].playDeck.length).toBe(originalDeckSize + 2);
    expect(afterSecond.players[0].playDeck.map(c => c.instanceId)).toEqual(expect.arrayContaining([glamdringId, stingId]));
    expect(afterSecond.players[0].sideboard).toHaveLength(0);

    // Sub-flow cleared.
    expect(afterSecond.pendingEffects).toHaveLength(0);

    // Leaf removed from the game: out-of-play pile, never the discard pile.
    expect(afterSecond.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(leafId);
    expect(afterSecond.players[0].discardPile.map(c => c.instanceId)).not.toContain(leafId);
    expect(afterSecond.players[0].outOfPlayPile.map(c => c.instanceId)).toContain(leafId);
  });

  test('taking only one resource (then passing) still removes the leaf from the game', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LONGBOTTOM_LEAF], siteDeck: [MORIA], sideboard: [GLAMDRING, STING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const leafId = handCardId(state, RESOURCE_PLAYER);
    const glamdringId = state.players[0].sideboard[0].instanceId;
    const originalDeckSize = state.players[0].playDeck.length;

    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: leafId }));
    const afterFirst = dispatch(afterPlay, { type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: glamdringId, source: 'sideboard' });
    // Pass to stop after one — "up to two".
    const afterPass = dispatch(afterFirst, { type: 'pass', player: PLAYER_1 });

    // One resource moved; the other stays in the sideboard.
    expect(afterPass.players[0].playDeck.length).toBe(originalDeckSize + 1);
    expect(afterPass.players[0].playDeck.map(c => c.instanceId)).toContain(glamdringId);
    expect(afterPass.players[0].sideboard).toHaveLength(1);

    // Sub-flow cleared; leaf removed from the game.
    expect(afterPass.pendingEffects).toHaveLength(0);
    expect(afterPass.players[0].outOfPlayPile.map(c => c.instanceId)).toContain(leafId);
    expect(afterPass.players[0].discardPile.map(c => c.instanceId)).not.toContain(leafId);
  });

  test('passing immediately (taking zero) still removes the leaf from the game', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LONGBOTTOM_LEAF], siteDeck: [MORIA], sideboard: [GLAMDRING, STING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const leafId = handCardId(state, RESOURCE_PLAYER);
    const originalDeckSize = state.players[0].playDeck.length;

    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: leafId }));
    const afterPass = dispatch(afterPlay, { type: 'pass', player: PLAYER_1 });

    // Nothing fetched; sideboard and deck unchanged.
    expect(afterPass.players[0].sideboard).toHaveLength(2);
    expect(afterPass.players[0].playDeck.length).toBe(originalDeckSize);

    // Sub-flow cleared; leaf removed from the game, not discarded.
    expect(afterPass.pendingEffects).toHaveLength(0);
    expect(afterPass.phaseState.phase).toBe(Phase.LongEvent);
    expect(afterPass.players[0].outOfPlayPile.map(c => c.instanceId)).toContain(leafId);
    expect(afterPass.players[0].discardPile.map(c => c.instanceId)).not.toContain(leafId);
  });

  test('after the fetch completes, normal long-event actions resume', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LONGBOTTOM_LEAF], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const leafId = handCardId(state, RESOURCE_PLAYER);
    const glamdringId = state.players[0].sideboard[0].instanceId;

    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: leafId }));
    const afterFetch = dispatch(afterPlay, { type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: glamdringId, source: 'sideboard' });

    // Only one card was in the sideboard, but the effect allowed up to two, so
    // the sub-flow re-prompts for the (unused) second pick with only `pass`
    // available — no eligible cards remain.
    expect(afterFetch.pendingEffects).toHaveLength(1);
    expect(viableActions(afterFetch, PLAYER_1, 'fetch-from-pile')).toHaveLength(0);
    expect(viableActions(afterFetch, PLAYER_1, 'pass')).toHaveLength(1);

    // Passing ends the sub-flow and removes the leaf from the game.
    const afterSubflowPass = dispatch(afterFetch, { type: 'pass', player: PLAYER_1 });
    expect(afterSubflowPass.pendingEffects).toHaveLength(0);
    expect(afterSubflowPass.players[0].outOfPlayPile.map(c => c.instanceId)).toContain(leafId);

    // Normal long-event actions resume; passing again advances to the M/H phase.
    expect(viableActions(afterSubflowPass, PLAYER_1, 'pass')).toHaveLength(1);
    const afterPhasePass = dispatch(afterSubflowPass, { type: 'pass', player: PLAYER_1 });
    expect(afterPhasePass.phaseState.phase).toBe(Phase.MovementHazard);
  });
});
