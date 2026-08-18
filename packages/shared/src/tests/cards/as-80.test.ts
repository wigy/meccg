/**
 * @module as-80.test
 *
 * Card test: Dark Tryst (as-80)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 *
 * Text:
 *   "Draw three cards and remove this card from the game."
 *
 * Effects:
 *   1. draw-cards: count 3, removeFromGame true
 *
 * Engine support table:
 * | # | Rule                                                                       | Status      |
 * |---|-----------------------------------------------------------------------------|-------------|
 * | 1 | Playable as a resource short-event in any of the player's phases          | IMPLEMENTED |
 * | 2 | Played as an action on the chain of effects (CoE 9.4/9.5)                 | IMPLEMENTED |
 * | 3 | Draws three cards from the top of the play deck into hand                 | IMPLEMENTED |
 * | 4 | The spent card is removed from the game (out-of-play, not discard)        | IMPLEMENTED |
 * | 5 | A play deck exhausted mid-draw reshuffles and drawing resumes (CoE 2.4)   | IMPLEMENTED |
 * | 6 | Drawing stops only when deck AND discard pile are both empty              | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures (minion, per the card's Ringwraith alignment):
 *   ASTERNAK (le-1)        - minion man, forms the company
 *   MINAS_MORGUL (le-390)  - minion haven, the company's site
 *   Deck filler (le-23, le-36, le-292, as-90) - cards drawn / left behind
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  viableActions, findHandCardId, dispatch, resolveChain,
} from '../test-helpers.js';
import { Phase, Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const DARK_TRYST = 'as-80' as CardDefinitionId;
const ASTERNAK = 'le-1' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
// Distinct deck filler so draw order can be asserted precisely.
const LUITPRAND = 'le-23' as CardDefinitionId;
const OSTISEN = 'le-36' as CardDefinitionId;
const VARIAGS = 'le-292' as CardDefinitionId;
const JOIN_WITH_THAT_POWER = 'as-90' as CardDefinitionId;

function buildDarkTrystState(playDeck: CardDefinitionId[], discardPile: CardDefinitionId[] = []) {
  return buildTestState({
    phase: Phase.LongEvent,
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }],
        hand: [DARK_TRYST],
        siteDeck: [MINAS_MORGUL],
        playDeck,
        discardPile,
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
      },
    ],
  });
}

describe('Dark Tryst (as-80)', () => {
  beforeEach(() => resetMint());

  test('appears as a playable resource short-event in the long-event phase', () => {
    const state = buildDarkTrystState([LUITPRAND, OSTISEN, VARIAGS, JOIN_WITH_THAT_POWER]);
    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    expect(playActions[0].action.type).toBe('play-short-event');
  });

  test('is declared on the chain of effects rather than resolving immediately (CoE 9.4/9.5)', () => {
    // Regression for the "Dark Tryst" bug report (game mqqntwsp-3f418h, seq 68):
    // as a short event, Dark Tryst must go through the chain of effects so the
    // opponent has a chance to respond before the draw resolves — it must NOT
    // resolve inline at play time.
    const state = buildDarkTrystState([LUITPRAND, OSTISEN, VARIAGS, JOIN_WITH_THAT_POWER]);
    const darkTrystId = findHandCardId(state, RESOURCE_PLAYER, DARK_TRYST);

    const onChain = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: darkTrystId });

    // A chain is now active and the card rides on it (left the hand) — the draw
    // has NOT happened yet.
    expect(onChain.chain).not.toBeNull();
    expect(onChain.chain!.entries).toHaveLength(1);
    expect(onChain.chain!.entries[0].card?.instanceId).toBe(darkTrystId);
    // Priority sits with the opponent so they may respond before resolution.
    expect(onChain.chain!.priority).toBe(PLAYER_2);

    const p1 = onChain.players[RESOURCE_PLAYER];
    expect(p1.hand.map(c => c.instanceId)).not.toContain(darkTrystId);
    expect(p1.hand).toHaveLength(0); // no cards drawn yet
    expect(p1.playDeck).toHaveLength(4); // deck untouched until resolution
    expect(p1.outOfPlayPile).toHaveLength(0);

    // The opponent has chain priority and may pass it.
    const oppActions = viableActions(onChain, PLAYER_2, 'pass-chain-priority');
    expect(oppActions).toHaveLength(1);
  });

  test('draws the top three cards into hand and removes itself from the game once the chain resolves', () => {
    const state = buildDarkTrystState([LUITPRAND, OSTISEN, VARIAGS, JOIN_WITH_THAT_POWER]);
    const darkTrystId = findHandCardId(state, RESOURCE_PLAYER, DARK_TRYST);
    const deckBefore = state.players[RESOURCE_PLAYER].playDeck;
    const topThreeIds = deckBefore.slice(0, 3).map(c => c.instanceId);
    const fourthId = deckBefore[3].instanceId;

    const onChain = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: darkTrystId });
    const next = resolveChain(onChain);

    // Chain fully resolved and cleared.
    expect(next.chain).toBeNull();

    const p = next.players[RESOURCE_PLAYER];

    // Exactly the top three cards moved from deck to hand, in order.
    expect(p.hand.map(c => c.instanceId)).toEqual(topThreeIds);
    expect(p.playDeck.map(c => c.instanceId)).toEqual([fourthId]);

    // Dark Tryst itself is gone from hand, removed from the game (out-of-play),
    // and crucially NOT in the discard pile (cannot be recurred).
    expect(p.hand.map(c => c.instanceId)).not.toContain(darkTrystId);
    expect(p.outOfPlayPile.map(c => c.instanceId)).toContain(darkTrystId);
    expect(p.discardPile.map(c => c.instanceId)).not.toContain(darkTrystId);
  });

  test('drawing stops at deck exhaustion without losing any card instance when the discard pile is also empty', () => {
    // Only two cards in the deck and nothing in the discard pile; Dark Tryst
    // asks for three. Nothing is left to reshuffle in, so the draw is partial.
    const state = buildDarkTrystState([LUITPRAND, OSTISEN]);
    const darkTrystId = findHandCardId(state, RESOURCE_PLAYER, DARK_TRYST);
    const deckIds = state.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId);

    const onChain = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: darkTrystId });
    const next = resolveChain(onChain);

    const p = next.players[RESOURCE_PLAYER];
    // Both available cards drawn, deck now empty, no extra card conjured.
    expect(p.hand.map(c => c.instanceId)).toEqual(deckIds);
    expect(p.playDeck).toHaveLength(0);
    // Still removed from the game even when the draw was partial.
    expect(p.outOfPlayPile.map(c => c.instanceId)).toContain(darkTrystId);
    expect(p.discardPile.map(c => c.instanceId)).not.toContain(darkTrystId);
  });

  test('reshuffles the discard pile mid-draw and resumes drawing when the play deck runs out (CoE 2.4)', () => {
    // Regression for the "Fark Tryst" bug report (game msxc5o26-l4c4wc, seq
    // 1121): Dark Tryst's draw of three cards emptied a one-card play deck
    // after the first draw, but the engine stopped there instead of
    // reshuffling the discard pile and drawing the remaining two cards.
    const state = buildDarkTrystState([LUITPRAND, OSTISEN], [VARIAGS, JOIN_WITH_THAT_POWER]);
    const darkTrystId = findHandCardId(state, RESOURCE_PLAYER, DARK_TRYST);
    const startingExhaustionCount = state.players[RESOURCE_PLAYER].deckExhaustionCount;

    const onChain = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: darkTrystId });
    const next = resolveChain(onChain);

    const p = next.players[RESOURCE_PLAYER];
    // All three cards drawn: two from the original deck, then a reshuffle of
    // the discard pile supplies the third.
    expect(p.hand).toHaveLength(3);
    // The discard pile's two cards were fully shuffled into the new play
    // deck: one was drawn, one remains on top.
    expect(p.playDeck).toHaveLength(1);
    expect(p.discardPile.map(c => c.instanceId)).not.toContain(darkTrystId);
    expect(p.discardPile).toHaveLength(0);
    // A genuine rule-2.4 exhaustion occurred.
    expect(p.deckExhaustionCount).toBe(startingExhaustionCount + 1);
    // Dark Tryst itself is still removed from the game, not shuffled back in.
    expect(p.outOfPlayPile.map(c => c.instanceId)).toContain(darkTrystId);
    // No card instance lost: original deck + discard pile cards all land in
    // hand or playDeck.
    const originalIds = [LUITPRAND, OSTISEN, VARIAGS, JOIN_WITH_THAT_POWER];
    expect(p.hand.length + p.playDeck.length).toBe(originalIds.length);
  });
});
