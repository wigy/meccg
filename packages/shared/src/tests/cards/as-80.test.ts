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
 * | # | Rule                                                                | Status      |
 * |---|---------------------------------------------------------------------|-------------|
 * | 1 | Playable as a resource short-event in any of the player's phases    | IMPLEMENTED |
 * | 2 | Draws three cards from the top of the play deck into hand           | IMPLEMENTED |
 * | 3 | The spent card is removed from the game (out-of-play, not discard)  | IMPLEMENTED |
 * | 4 | Drawing stops at deck exhaustion (no card disappears)              | IMPLEMENTED |
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
  viableActions, findHandCardId, dispatch,
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

function buildDarkTrystState(playDeck: CardDefinitionId[]) {
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

  test('draws the top three cards into hand and removes itself from the game', () => {
    const state = buildDarkTrystState([LUITPRAND, OSTISEN, VARIAGS, JOIN_WITH_THAT_POWER]);
    const darkTrystId = findHandCardId(state, RESOURCE_PLAYER, DARK_TRYST);
    const deckBefore = state.players[RESOURCE_PLAYER].playDeck;
    const topThreeIds = deckBefore.slice(0, 3).map(c => c.instanceId);
    const fourthId = deckBefore[3].instanceId;

    const next = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: darkTrystId });

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

  test('drawing stops at deck exhaustion without losing any card instance', () => {
    // Only two cards in the deck; Dark Tryst asks for three.
    const state = buildDarkTrystState([LUITPRAND, OSTISEN]);
    const darkTrystId = findHandCardId(state, RESOURCE_PLAYER, DARK_TRYST);
    const deckIds = state.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId);

    const next = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: darkTrystId });

    const p = next.players[RESOURCE_PLAYER];
    // Both available cards drawn, deck now empty, no extra card conjured.
    expect(p.hand.map(c => c.instanceId)).toEqual(deckIds);
    expect(p.playDeck).toHaveLength(0);
    // Still removed from the game even when the draw was partial.
    expect(p.outOfPlayPile.map(c => c.instanceId)).toContain(darkTrystId);
    expect(p.discardPile.map(c => c.instanceId)).not.toContain(darkTrystId);
  });
});
