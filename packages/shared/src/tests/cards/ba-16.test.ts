/**
 * @module ba-16.test
 *
 * Card test: Desire All for Thy Belly (ba-16)
 * Type: hazard-event (short), non-unique
 * Effects: 2
 *   1. play-discard-cost — discard a Spawn card from hand (source: hand)
 *   2. reveal-deck-choose-penalty — reveal (# Spawn cards in play) from the top
 *      of the opponent's deck; card-player shows one; opponent removes it from
 *      the game or permanently loses one hand size; the rest are shuffled back.
 *
 * Card text: "To play this card, you must discard a Spawn card from your hand.
 *  Reveal to yourself a number of cards from the top of opponent's play deck
 *  equal to the number of Spawn cards in play. Eliminated spawn do not count.
 *  Choose one card and show it to your opponent. He must choose to either:
 *  remove the card from the game or decrease the number of cards he may hold in
 *  his hand by one for the rest of the game. Shuffle and replace all remaining
 *  cards back on top of his play deck. Remove this card from the game."
 *
 * Engine Support:
 * | # | Feature                                                | Status      | Notes                                            |
 * |---|--------------------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | Play cost: discard a Spawn card from hand              | IMPLEMENTED | play-discard-cost on an untargeted short event   |
 * | 2 | Not playable without a Spawn card in hand             | IMPLEMENTED | no viable play-hazard when none matches          |
 * | 3 | Reveal top N = number of Spawn cards in play          | IMPLEMENTED | reveal-deck-choose-penalty count over cardsInPlay|
 * | 4 | Eliminated spawn (not in play) do not count           | IMPLEMENTED | only cardsInPlay counted → 0 reveal fizzle       |
 * | 5 | Card-player shows one revealed card                   | IMPLEMENTED | desire-belly-choose-card pending (actor=player)  |
 * | 6 | Opponent removes the card from the game               | IMPLEMENTED | desire-belly-choose-penalty → out-of-play        |
 * | 7 | Opponent permanently reduces hand size by one         | IMPLEMENTED | until-cleared hand-size-modifier -1 constraint   |
 * | 8 | Remaining revealed cards shuffled back on top of deck | IMPLEMENTED | deck length preserved, rest untouched            |
 * | 9 | The event card is removed from the game               | IMPLEMENTED | discard → out-of-play on resolution              |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN,
  CRAM, STING, ORC_WARBAND, HORN_OF_ANOR,
  MORIA, LORIEN, RIVENDELL,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, resetMint, makeMHState, addCardInPlay,
  viableActions, viableFor, dispatch, resolveChain,
  findHandCardId, assertEveryInstanceReachable,
} from '../test-helpers.js';
import { resolveHandSize } from '../../engine/effects/index.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const DESIRE = 'ba-16' as CardDefinitionId;
// Spawn-keyword cards (BA): the one held in hand pays the play cost; the ones in
// play set the reveal count.
const SPAWN_COST = 'ba-24' as CardDefinitionId;      // Spawn of Ungoliant (cost card, in hand)
const SPAWN_IN_PLAY_A = 'ba-27' as CardDefinitionId; // Ungoliant's Progeny (in play)
const SPAWN_IN_PLAY_B = 'ba-28' as CardDefinitionId; // Ungoliant's Foul Issue (in play)

/**
 * Build an M/H state: PLAYER_1 (resource) active at Moria, PLAYER_2 (hazard)
 * holding Desire All for Thy Belly plus the given hand cards. `oppDeck` seeds
 * the resource player's play deck (the deck the card reveals from, top-first).
 */
function buildDesire(opts: {
  hazardHand?: CardDefinitionId[];
  oppDeck?: CardDefinitionId[];
  spawnInPlay?: CardDefinitionId[];
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        playDeck: opts.oppDeck ?? [CRAM, STING, ORC_WARBAND, HORN_OF_ANOR],
        siteDeck: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [DESIRE, ...(opts.hazardHand ?? [SPAWN_COST])],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  let state: GameState = { ...base, phaseState: makeMHState() };
  for (const s of opts.spawnInPlay ?? [SPAWN_IN_PLAY_A, SPAWN_IN_PLAY_B]) {
    state = addCardInPlay(state, HAZARD_PLAYER, s);
  }
  return state;
}

/** The viable play-hazard action for Desire (undefined if not playable). */
function desirePlay(state: GameState) {
  const cardId = findHandCardId(state, HAZARD_PLAYER, DESIRE);
  return viableActions(state, PLAYER_2, 'play-hazard')
    .find(a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === cardId);
}

/** Play Desire (by the hazard player) with its Spawn discard cost and resolve the chain. */
function playDesire(state: GameState): GameState {
  const play = desirePlay(state);
  expect(play).toBeDefined();
  return resolveChain(dispatch(state, play!.action));
}

const chooseCardPending = (s: GameState) =>
  s.pendingResolutions.find(r => r.kind.type === 'desire-belly-choose-card');
const choosePenaltyPending = (s: GameState) =>
  s.pendingResolutions.find(r => r.kind.type === 'desire-belly-choose-penalty');

/** Instance id at a position in the resource player's play deck. */
function deckIdAt(state: GameState, pos: number): CardInstanceId {
  return state.players[RESOURCE_PLAYER].playDeck[pos].instanceId;
}

describe('Desire All for Thy Belly (ba-16)', () => {
  beforeEach(() => resetMint());

  test('play cost: one action per Spawn card in hand, carrying the discard', () => {
    const state = buildDesire({ hazardHand: [SPAWN_COST] });
    const spawnId = findHandCardId(state, HAZARD_PLAYER, SPAWN_COST);

    const play = desirePlay(state);
    expect(play).toBeDefined();
    // The play carries the chosen Spawn card as its discard cost.
    expect((play!.action as { costDiscardInstanceId?: CardInstanceId }).costDiscardInstanceId).toBe(spawnId);
  });

  test('not playable without a Spawn card in hand', () => {
    // Hand holds only a non-Spawn card (Cram) besides Desire.
    const state = buildDesire({ hazardHand: [CRAM] });
    // No viable play of the event — the discard cost cannot be paid.
    expect(desirePlay(state)).toBeUndefined();
  });

  test('paying the cost discards the Spawn card; reveals top N of the opponent deck (N = spawn in play)', () => {
    // Two Spawn cards in play → reveal the top two of the opponent's deck.
    const state = buildDesire({});
    const top0 = deckIdAt(state, 0);
    const top1 = deckIdAt(state, 1);
    const spawnId = findHandCardId(state, HAZARD_PLAYER, SPAWN_COST);

    const resolved = playDesire(state);

    // The Spawn cost card was discarded from hand.
    expect(resolved.players[HAZARD_PLAYER].hand.map(c => c.instanceId)).not.toContain(spawnId);
    expect(resolved.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId)).toContain(spawnId);

    // The event itself is removed from the game (not left in the discard pile).
    expect(resolved.players[HAZARD_PLAYER].outOfPlayPile.some(c => c.definitionId === DESIRE)).toBe(true);
    expect(resolved.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === DESIRE)).toBe(false);

    // Exactly the top two deck cards are revealed and offered to the card-player.
    const pending = chooseCardPending(resolved);
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_2);
    expect(pending!.kind.type === 'desire-belly-choose-card' && new Set(pending!.kind.revealedInstanceIds))
      .toEqual(new Set([top0, top1]));
    for (const id of [top0, top1]) expect(resolved.revealedInstances[id]).toBeDefined();

    // One show-choice per revealed card; the opponent waits.
    const choices = viableActions(resolved, PLAYER_2, 'desire-choose-shown-card')
      .map(a => (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId);
    expect(new Set(choices)).toEqual(new Set([top0, top1]));
    expect(viableFor(resolved, PLAYER_1)).toHaveLength(0);

    assertEveryInstanceReachable(resolved);
  });

  test('reveal count follows the number of Spawn cards in play (one → reveal one)', () => {
    const state = buildDesire({ spawnInPlay: [SPAWN_IN_PLAY_A] });
    const top0 = deckIdAt(state, 0);

    const resolved = playDesire(state);
    const pending = chooseCardPending(resolved);
    expect(pending).toBeDefined();
    expect(pending!.kind.type === 'desire-belly-choose-card' && pending!.kind.revealedInstanceIds.length).toBe(1);
    expect(pending!.kind.type === 'desire-belly-choose-card' && pending!.kind.revealedInstanceIds[0]).toBe(top0);

    assertEveryInstanceReachable(resolved);
  });

  test('no Spawn cards in play → reveal zero; the event fizzles but is still removed from the game', () => {
    const state = buildDesire({ spawnInPlay: [] });
    const deckBefore = state.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId);

    const resolved = playDesire(state);

    expect(chooseCardPending(resolved)).toBeUndefined();
    expect(choosePenaltyPending(resolved)).toBeUndefined();
    // Deck untouched.
    expect(resolved.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId)).toEqual(deckBefore);
    // Event still removed from the game.
    expect(resolved.players[HAZARD_PLAYER].outOfPlayPile.some(c => c.definitionId === DESIRE)).toBe(true);

    assertEveryInstanceReachable(resolved);
  });

  test('opponent choice: remove the shown card from the game; the rest shuffle back on top', () => {
    const state = buildDesire({});
    const top0 = deckIdAt(state, 0);
    const top1 = deckIdAt(state, 1);
    const rest = state.players[RESOURCE_PLAYER].playDeck.slice(2).map(c => c.instanceId);

    let s = playDesire(state);
    // Card-player shows the first revealed card.
    s = dispatch(s, { type: 'desire-choose-shown-card', player: PLAYER_2, cardInstanceId: top0 });

    // Now the opponent (resource player) faces the forced choice.
    const penalty = choosePenaltyPending(s);
    expect(penalty).toBeDefined();
    expect(penalty!.actor).toBe(PLAYER_1);
    expect(new Set(viableActions(s, PLAYER_1, 'desire-choose-penalty').map(a => (a.action as { penalty: string }).penalty)))
      .toEqual(new Set(['remove-from-game', 'reduce-hand-size']));
    // The hazard player waits during the opponent's choice.
    expect(viableFor(s, PLAYER_2)).toHaveLength(0);

    const done = dispatch(s, { type: 'desire-choose-penalty', player: PLAYER_1, penalty: 'remove-from-game' });
    expect(choosePenaltyPending(done)).toBeUndefined();

    const opp = done.players[RESOURCE_PLAYER];
    // The shown card is removed from the game.
    expect(opp.outOfPlayPile.map(c => c.instanceId)).toContain(top0);
    expect(opp.playDeck.map(c => c.instanceId)).not.toContain(top0);
    // The other revealed card is back on top; the rest of the deck is unchanged below.
    expect(opp.playDeck[0].instanceId).toBe(top1);
    expect(opp.playDeck.slice(1).map(c => c.instanceId)).toEqual(rest);
    // Hand size unaffected (the alternative penalty was not taken).
    expect(resolveHandSize(done, RESOURCE_PLAYER)).toBe(8);

    assertEveryInstanceReachable(done);
  });

  test('opponent choice: reduce hand size permanently; every revealed card shuffles back on top', () => {
    const state = buildDesire({});
    const top0 = deckIdAt(state, 0);
    const top1 = deckIdAt(state, 1);
    const rest = state.players[RESOURCE_PLAYER].playDeck.slice(2).map(c => c.instanceId);
    const deckLen = state.players[RESOURCE_PLAYER].playDeck.length;

    let s = playDesire(state);
    s = dispatch(s, { type: 'desire-choose-shown-card', player: PLAYER_2, cardInstanceId: top0 });
    const done = dispatch(s, { type: 'desire-choose-penalty', player: PLAYER_1, penalty: 'reduce-hand-size' });

    expect(choosePenaltyPending(done)).toBeUndefined();
    const opp = done.players[RESOURCE_PLAYER];
    // Nothing removed from the game; the deck keeps every card.
    expect(opp.outOfPlayPile).toHaveLength(0);
    expect(opp.playDeck).toHaveLength(deckLen);
    // Both revealed cards are on top (order may be shuffled); the rest are unchanged below.
    expect(new Set(opp.playDeck.slice(0, 2).map(c => c.instanceId))).toEqual(new Set([top0, top1]));
    expect(opp.playDeck.slice(2).map(c => c.instanceId)).toEqual(rest);
    // Hand size is permanently reduced by one.
    expect(resolveHandSize(done, RESOURCE_PLAYER)).toBe(7);

    assertEveryInstanceReachable(done);
  });

  test('reveal count is capped by the opponent deck length', () => {
    // Three Spawn cards in play but only one card in the opponent's deck.
    const state = buildDesire({
      spawnInPlay: [SPAWN_IN_PLAY_A, SPAWN_IN_PLAY_B, 'ba-21' as CardDefinitionId],
      oppDeck: [CRAM],
    });
    const only = deckIdAt(state, 0);

    const resolved = playDesire(state);
    const pending = chooseCardPending(resolved);
    expect(pending).toBeDefined();
    expect(pending!.kind.type === 'desire-belly-choose-card' && pending!.kind.revealedInstanceIds).toEqual([only]);

    assertEveryInstanceReachable(resolved);
  });
});
