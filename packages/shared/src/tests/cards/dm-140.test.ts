/**
 * @module dm-140.test
 *
 * Card test: Horns, Horns, Horns (dm-140)
 * Type: hero-resource-event (short)
 * Alignment: hero (wizard)
 *
 * Text:
 *   "Each player removes all factions from his discard pile and shuffles
 *    them into his play deck."
 *
 * Effects:
 *   1. reshuffle-from-discard: scope all-players, filter = faction card types
 *
 * Engine support table:
 * | # | Rule                                                                    | Status      |
 * |---|-------------------------------------------------------------------------|-------------|
 * | 1 | Playable as a resource short-event in any of the player's phases        | IMPLEMENTED |
 * | 2 | Every faction in EACH player's discard pile returns to their play deck  | IMPLEMENTED |
 * | 3 | Non-faction cards stay in the discard pile                              | IMPLEMENTED |
 * | 4 | The affected play decks are shuffled (no card instance lost)            | IMPLEMENTED |
 * | 5 | The spent event card itself goes to the player's discard pile          | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures (hero, per the card's wizard alignment):
 *   ARAGORN (tw-1) / RIVENDELL (tw-361)  - player 1's company & site
 *   LEGOLAS (tw-13) / LORIEN (tw-358)    - player 2's company & site
 *   Factions: Men of Dale (td-138), Men of Lake-town (td-139),
 *             Returned Exiles (td-146)
 *   Non-faction filler: Glamdring (tw-244, a hero item) stays put
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  viableActions, findHandCardId, dispatch,
  ARAGORN, RIVENDELL, LEGOLAS, LORIEN, MORIA,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const HORNS = 'dm-140' as CardDefinitionId;
const MEN_OF_DALE = 'td-138' as CardDefinitionId;
const MEN_OF_LAKE_TOWN = 'td-139' as CardDefinitionId;
const RETURNED_EXILES = 'td-146' as CardDefinitionId;
const GLAMDRING = 'tw-244' as CardDefinitionId;

function buildHornsState(opts: {
  p1Discard: CardDefinitionId[];
  p1Deck: CardDefinitionId[];
  p2Discard: CardDefinitionId[];
  p2Deck: CardDefinitionId[];
}) {
  return buildTestState({
    phase: Phase.LongEvent,
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [HORNS],
        siteDeck: [RIVENDELL],
        discardPile: opts.p1Discard,
        playDeck: opts.p1Deck,
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [LORIEN],
        discardPile: opts.p2Discard,
        playDeck: opts.p2Deck,
      },
    ],
  });
}

describe('Horns, Horns, Horns (dm-140)', () => {
  beforeEach(() => resetMint());

  test('appears as a playable resource short-event in the long-event phase', () => {
    const state = buildHornsState({
      p1Discard: [MEN_OF_DALE], p1Deck: [MORIA],
      p2Discard: [], p2Deck: [MORIA],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    expect(playActions[0].action.type).toBe('play-short-event');
  });

  test("moves every faction from each player's discard pile into their play deck", () => {
    const state = buildHornsState({
      p1Discard: [MEN_OF_DALE, GLAMDRING, MEN_OF_LAKE_TOWN],
      p1Deck: [MORIA],
      p2Discard: [RETURNED_EXILES, GLAMDRING],
      p2Deck: [MORIA],
    });
    const hornsId = findHandCardId(state, RESOURCE_PLAYER, HORNS);

    // Capture instance IDs before resolving so we can assert exact movement.
    const p1Before = state.players[RESOURCE_PLAYER];
    const p2Before = state.players[HAZARD_PLAYER];
    const p1FactionIds = p1Before.discardPile
      .filter(c => c.definitionId === MEN_OF_DALE || c.definitionId === MEN_OF_LAKE_TOWN)
      .map(c => c.instanceId);
    const p1GlamdringId = p1Before.discardPile.find(c => c.definitionId === GLAMDRING)!.instanceId;
    const p1DeckIdsBefore = p1Before.playDeck.map(c => c.instanceId);
    const p2FactionId = p2Before.discardPile.find(c => c.definitionId === RETURNED_EXILES)!.instanceId;
    const p2GlamdringId = p2Before.discardPile.find(c => c.definitionId === GLAMDRING)!.instanceId;
    const p2DeckIdsBefore = p2Before.playDeck.map(c => c.instanceId);

    const next = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: hornsId });

    const p1 = next.players[RESOURCE_PLAYER];
    const p2 = next.players[HAZARD_PLAYER];

    // Player 1: both factions moved out of discard into the play deck.
    const p1DeckIdsAfter = p1.playDeck.map(c => c.instanceId);
    for (const fid of p1FactionIds) {
      expect(p1DeckIdsAfter).toContain(fid);
      expect(p1.discardPile.map(c => c.instanceId)).not.toContain(fid);
    }
    // Original deck cards are still present (nothing lost).
    for (const did of p1DeckIdsBefore) expect(p1DeckIdsAfter).toContain(did);
    expect(p1.playDeck).toHaveLength(p1DeckIdsBefore.length + p1FactionIds.length);

    // Player 1: the non-faction item stays in the discard pile.
    expect(p1.discardPile.map(c => c.instanceId)).toContain(p1GlamdringId);

    // Player 2: its single faction moved into the play deck, item stays.
    const p2DeckIdsAfter = p2.playDeck.map(c => c.instanceId);
    expect(p2DeckIdsAfter).toContain(p2FactionId);
    for (const did of p2DeckIdsBefore) expect(p2DeckIdsAfter).toContain(did);
    expect(p2.playDeck).toHaveLength(p2DeckIdsBefore.length + 1);
    expect(p2.discardPile.map(c => c.instanceId)).toContain(p2GlamdringId);
    expect(p2.discardPile.map(c => c.instanceId)).not.toContain(p2FactionId);
  });

  test('the spent Horns card lands in the playing player\'s discard pile', () => {
    const state = buildHornsState({
      p1Discard: [MEN_OF_DALE], p1Deck: [MORIA],
      p2Discard: [], p2Deck: [MORIA],
    });
    const hornsId = findHandCardId(state, RESOURCE_PLAYER, HORNS);

    const next = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: hornsId });

    const p1 = next.players[RESOURCE_PLAYER];
    expect(p1.hand.map(c => c.instanceId)).not.toContain(hornsId);
    expect(p1.discardPile.map(c => c.instanceId)).toContain(hornsId);
    // Horns is not a faction, so it never gets swept into the deck.
    expect(p1.playDeck.map(c => c.instanceId)).not.toContain(hornsId);
  });

  test('no faction in any discard pile is a no-op that still discards the event', () => {
    const state = buildHornsState({
      p1Discard: [GLAMDRING], p1Deck: [MORIA],
      p2Discard: [GLAMDRING], p2Deck: [MORIA],
    });
    const hornsId = findHandCardId(state, RESOURCE_PLAYER, HORNS);
    const p1DeckLenBefore = state.players[RESOURCE_PLAYER].playDeck.length;
    const p2DeckLenBefore = state.players[HAZARD_PLAYER].playDeck.length;

    const next = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: hornsId });

    const p1 = next.players[RESOURCE_PLAYER];
    const p2 = next.players[HAZARD_PLAYER];
    // No factions anywhere: decks unchanged in size, items stay in discard.
    expect(p1.playDeck).toHaveLength(p1DeckLenBefore);
    expect(p2.playDeck).toHaveLength(p2DeckLenBefore);
    expect(p1.discardPile.some(c => c.definitionId === GLAMDRING)).toBe(true);
    expect(p2.discardPile.some(c => c.definitionId === GLAMDRING)).toBe(true);
    // Event still consumed.
    expect(p1.discardPile.map(c => c.instanceId)).toContain(hornsId);
  });
});
