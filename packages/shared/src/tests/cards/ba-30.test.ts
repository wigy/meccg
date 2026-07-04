/**
 * @module ba-30.test
 *
 * Card test: Longbottom Leaf (ba-30)
 * Type: hero-resource-event (short)
 * Effects: 1 (move / fetch-to-deck from sideboard, count 2, removeFromGame)
 *
 * "Take up to two resources from your sideboard to your play deck and
 *  reshuffle. Remove this card from the game."
 *
 * Modeled as a fetch-shape `move` short event: pull up to two resource
 * cards (items/allies/factions/events — never characters) from the
 * owner's sideboard into the play deck, shuffling after each pick. The
 * `count: 2` fetch offers one pick at a time with an always-available
 * `pass`, so the player may retrieve zero, one, or two ("up to two").
 * `removeFromGame: true` routes the spent event to the out-of-play pile
 * instead of the discard pile once the fetch resolves or is passed.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO,
  GLAMDRING, STING, GWAIHIR, WOOD_ELVES,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, actionAs,
  handCardId, dispatch, resolveChain, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { FetchFromPileAction, CardDefinitionId } from '../../index.js';

const LONGBOTTOM_LEAF = 'ba-30' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Longbottom Leaf (ba-30)', () => {
  beforeEach(() => resetMint());

  test('appears as a playable resource short-event', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LONGBOTTOM_LEAF], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    expect(playActions[0].action.type).toBe('play-short-event');
  });

  test('playing initiates a chain so the opponent can respond', () => {
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

    // A chain is active; the fetch has not resolved yet.
    expect(afterPlay.chain).not.toBeNull();
    expect(afterPlay.players[0].hand).toHaveLength(0);
    expect(afterPlay.pendingEffects).toHaveLength(0);

    const opponentActions = computeLegalActions(afterPlay, PLAYER_2);
    expect(opponentActions.some(ea => ea.action.type === 'pass-chain-priority')).toBe(true);
  });

  test('after the chain resolves, the fetch sub-flow is active', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LONGBOTTOM_LEAF], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const leafId = handCardId(state, RESOURCE_PLAYER);
    const next = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: leafId }));

    // Longbottom Leaf is on the table while its fetch resolves — not yet disposed.
    expect(next.chain).toBeNull();
    expect(next.players[0].cardsInPlay.map(c => c.instanceId)).toContain(leafId);
    expect(next.players[0].discardPile.map(c => c.instanceId)).not.toContain(leafId);
    expect(next.players[0].outOfPlayPile.map(c => c.instanceId)).not.toContain(leafId);

    expect(next.pendingEffects).toHaveLength(1);
    expect(next.pendingEffects[0].type).toBe('card-effect');
    expect(next.pendingEffects[0].effect.type).toBe('fetch-to-deck');
    expect(next.pendingEffects[0].cardInstanceId).toBe(leafId);
  });

  test('only resources (not characters/sites) in the sideboard are eligible', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [LONGBOTTOM_LEAF],
          siteDeck: [MORIA],
          // Items, an ally, and a faction are resources → eligible.
          // A character (Bilbo) and a site (Moria) are NOT resources → excluded.
          sideboard: [GLAMDRING, STING, GWAIHIR, WOOD_ELVES, BILBO, MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const leafId = handCardId(state, RESOURCE_PLAYER);
    const next = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: leafId }));

    const fetchActions = viableActions(next, PLAYER_1, 'fetch-from-pile');
    // Glamdring, Sting, Gwaihir, Wood-elves — four resources; Bilbo/Moria excluded.
    expect(fetchActions).toHaveLength(4);
    for (const ea of fetchActions) {
      expect(actionAs<FetchFromPileAction>(ea.action).source).toBe('sideboard');
    }

    // Pass is always available (the "take up to two" lower bound of zero).
    expect(viableActions(next, PLAYER_1, 'pass')).toHaveLength(1);
  });

  test('fetching one resource shuffles it into the deck and offers a second pick', () => {
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

    // Glamdring is now in the play deck; sideboard shrank by one.
    expect(afterFirst.players[0].playDeck.length).toBe(originalDeckSize + 1);
    expect(afterFirst.players[0].playDeck.map(c => c.instanceId)).toContain(glamdringId);
    expect(afterFirst.players[0].sideboard.map(c => c.instanceId)).not.toContain(glamdringId);

    // A second pick remains ("up to two") — the card is still on the table.
    expect(afterFirst.pendingEffects).toHaveLength(1);
    expect(afterFirst.pendingEffects[0].effect.type).toBe('fetch-to-deck');
    expect(afterFirst.players[0].cardsInPlay.map(c => c.instanceId)).toContain(leafId);
    // The one remaining sideboard resource is still offered.
    expect(viableActions(afterFirst, PLAYER_1, 'fetch-from-pile')).toHaveLength(1);
  });

  test('fetching two resources removes Longbottom Leaf from the game', () => {
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
    const afterFirst = dispatch(afterPlay, { type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: glamdringId, source: 'sideboard' });
    const afterSecond = dispatch(afterFirst, { type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: stingId, source: 'sideboard' });

    // Both resources shuffled into the play deck; sideboard emptied.
    expect(afterSecond.players[0].playDeck.length).toBe(originalDeckSize + 2);
    expect(afterSecond.players[0].playDeck.map(c => c.instanceId)).toEqual(
      expect.arrayContaining([glamdringId, stingId]),
    );
    expect(afterSecond.players[0].sideboard).toHaveLength(0);

    // The fetch is done and Longbottom Leaf is removed from the game — it lands
    // in the out-of-play pile, never the discard pile (so it can't be recurred).
    expect(afterSecond.pendingEffects).toHaveLength(0);
    expect(afterSecond.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(leafId);
    expect(afterSecond.players[0].discardPile.map(c => c.instanceId)).not.toContain(leafId);
    expect(afterSecond.players[0].outOfPlayPile.map(c => c.instanceId)).toContain(leafId);
  });

  test('passing without fetching still removes Longbottom Leaf from the game', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LONGBOTTOM_LEAF], siteDeck: [MORIA], sideboard: [GLAMDRING] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const leafId = handCardId(state, RESOURCE_PLAYER);
    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: leafId }));
    const afterPass = dispatch(afterPlay, { type: 'pass', player: PLAYER_1 });

    // Sub-flow cleared, sideboard untouched.
    expect(afterPass.pendingEffects).toHaveLength(0);
    expect(afterPass.players[0].sideboard).toHaveLength(1);

    // Removed from the game even when no card was taken.
    expect(afterPass.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(leafId);
    expect(afterPass.players[0].discardPile.map(c => c.instanceId)).not.toContain(leafId);
    expect(afterPass.players[0].outOfPlayPile.map(c => c.instanceId)).toContain(leafId);

    // Normal long-event play resumes.
    expect(afterPass.phaseState.phase).toBe(Phase.LongEvent);
  });

  test('fetching one then passing removes Longbottom Leaf from the game', () => {
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

    const afterPlay = resolveChain(dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: leafId }));
    const afterFirst = dispatch(afterPlay, { type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: glamdringId, source: 'sideboard' });
    const afterPass = dispatch(afterFirst, { type: 'pass', player: PLAYER_1 });

    // One resource retrieved, second pick declined; the un-taken resource stays
    // in the sideboard and Longbottom Leaf is removed from the game.
    expect(afterPass.pendingEffects).toHaveLength(0);
    expect(afterPass.players[0].playDeck.map(c => c.instanceId)).toContain(glamdringId);
    expect(afterPass.players[0].sideboard.map(c => c.instanceId)).toEqual([stingId]);
    expect(afterPass.players[0].outOfPlayPile.map(c => c.instanceId)).toContain(leafId);
    expect(afterPass.players[0].discardPile.map(c => c.instanceId)).not.toContain(leafId);
  });
});
