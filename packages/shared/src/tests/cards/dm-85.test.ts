/**
 * @module dm-85.test
 *
 * Card test: Revealed to all Watchers (dm-85)
 * Type: hazard-event (short), unique
 * Effects: 1
 *   1. cycle-hand — revealHand, keepInHand: hazard card types,
 *      drawToHandSize, setAsideTo: deck-top
 *
 * Card text: "Unique. Reveal your hand to opponent. Place all non-hazard cards
 *  from your hand off to the side. Draw cards from your play deck until your
 *  hand size is reached. Place the non-hazard cards from off to the side face
 *  down on top of your play deck in any order you choose."
 *
 * When the hazard player plays this short-event, it resolves on the chain and
 * cycles the **playing player's own** hand: the hand is revealed to the
 * opponent, the hazard cards (hazard-creature / hazard-event) are kept, the
 * non-hazard cards are set aside, the hand is refilled from the top of the play
 * deck up to the player's hand size (8), and the set-aside cards are placed
 * face-down on top of the play deck. When two or more cards were set aside, the
 * player orders them via an `arrange-deck-top` pending resolution (one
 * `arrange-deck-top-card` pick at a time), while the opponent waits.
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                          |
 * |---|--------------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Play from hand as an untargeted hazard short     | IMPLEMENTED | generic play-hazards fallthrough               |
 * | 2 | Reveal the playing player's hand to opponent     | IMPLEMENTED | revealInstances over the hand                  |
 * | 3 | Keep hazard cards, set aside non-hazard cards    | IMPLEMENTED | keepInHand DSL filter (cardType $in hazards)   |
 * | 4 | Refill hand to hand size from the play deck      | IMPLEMENTED | resolveHandSize + draw, stops at exhaustion    |
 * | 5 | Set-aside cards placed on top of the play deck   | IMPLEMENTED | setAsideTo: deck-top                            |
 * | 6 | Player orders the set-aside cards ("any order")  | IMPLEMENTED | arrange-deck-top pending resolution            |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FRODO, GIMLI, BILBO,
  CAVE_DRAKE, ORC_WARBAND, TWO_OR_THREE_TRIBES_PRESENT,
  STING, HORN_OF_ANOR, CRAM, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HAUBERK_OF_BRIGHT_MAIL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  HAZARD_PLAYER,
  buildTestState, resetMint, makeMHState,
  viableActions, viableFor, dispatch, resolveChain,
  findHandCardId, assertEveryInstanceReachable,
} from '../test-helpers.js';
import { Phase, HAND_SIZE } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const REVEALED = 'dm-85' as CardDefinitionId;

/**
 * Build an M/H state with PLAYER_1 (resource) active at Moria and PLAYER_2
 * (hazard) holding Revealed to all Watchers plus caller-supplied extra hand
 * cards and a caller-supplied play deck.
 */
function buildRevealed(opts: {
  hazardExtraHand?: CardDefinitionId[];
  hazardDeck?: CardDefinitionId[];
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [REVEALED, ...(opts.hazardExtraHand ?? [])],
        playDeck: opts.hazardDeck ?? [],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  return { ...base, phaseState: makeMHState() };
}

/** Play Revealed to all Watchers (by the hazard player) and resolve the chain. */
function playRevealed(state: GameState): GameState {
  const cardId = findHandCardId(state, HAZARD_PLAYER, REVEALED);
  const play = viableActions(state, PLAYER_2, 'play-hazard')
    .find(a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === cardId);
  expect(play).toBeDefined();
  return resolveChain(dispatch(state, play!.action));
}

describe('Revealed to all Watchers (dm-85)', () => {
  beforeEach(() => resetMint());

  test('the hazard player may play it as an untargeted hazard short-event', () => {
    const state = buildRevealed({ hazardExtraHand: [CAVE_DRAKE, GIMLI], hazardDeck: [STING] });
    const cardId = findHandCardId(state, HAZARD_PLAYER, REVEALED);
    const play = viableActions(state, PLAYER_2, 'play-hazard')
      .find(a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === cardId);
    expect(play).toBeDefined();
  });

  test('reveals hand, keeps hazards, sets aside non-hazards, refills to hand size', () => {
    // Post-play hand: 2 hazards kept (Cave-drake, Two or Three Tribes) + 2
    // non-hazards set aside (Gimli, Sting). Deck holds 7 cards → 6 drawn to
    // reach hand size 8, 1 left under the two set-aside cards.
    const deck = [HORN_OF_ANOR, CRAM, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HAUBERK_OF_BRIGHT_MAIL, BILBO, FRODO];
    const state = buildRevealed({
      hazardExtraHand: [CAVE_DRAKE, TWO_OR_THREE_TRIBES_PRESENT, GIMLI, STING],
      hazardDeck: deck,
    });
    const caveId = findHandCardId(state, HAZARD_PLAYER, CAVE_DRAKE);
    const tribesId = findHandCardId(state, HAZARD_PLAYER, TWO_OR_THREE_TRIBES_PRESENT);
    const gimliId = findHandCardId(state, HAZARD_PLAYER, GIMLI);
    const stingId = findHandCardId(state, HAZARD_PLAYER, STING);
    const drawnIds = deck.slice(0, 6).map(d => state.players[HAZARD_PLAYER].playDeck.find(c => c.definitionId === d)!.instanceId);
    const frodoDeckId = state.players[HAZARD_PLAYER].playDeck.find(c => c.definitionId === FRODO)!.instanceId;

    const resolved = playRevealed(state);
    const hazard = resolved.players[HAZARD_PLAYER];

    // The whole (post-play) hand is revealed to the opponent.
    expect(resolved.revealedInstances[caveId]).toBe(CAVE_DRAKE);
    expect(resolved.revealedInstances[tribesId]).toBe(TWO_OR_THREE_TRIBES_PRESENT);
    expect(resolved.revealedInstances[gimliId]).toBe(GIMLI);
    expect(resolved.revealedInstances[stingId]).toBe(STING);

    // Hand refilled to hand size: 2 kept hazards + 6 fresh draws.
    expect(hazard.hand).toHaveLength(HAND_SIZE);
    const handIds = hazard.hand.map(c => c.instanceId);
    expect(handIds).toContain(caveId);
    expect(handIds).toContain(tribesId);
    for (const id of drawnIds) expect(handIds).toContain(id);
    // The set-aside non-hazards are no longer in hand.
    expect(handIds).not.toContain(gimliId);
    expect(handIds).not.toContain(stingId);

    // Set-aside cards sit on top of the deck; the un-drawn 7th card is beneath.
    expect(hazard.playDeck).toHaveLength(3);
    const topTwo = hazard.playDeck.slice(0, 2).map(c => c.instanceId);
    expect(new Set(topTwo)).toEqual(new Set([gimliId, stingId]));
    expect(hazard.playDeck[2].instanceId).toBe(frodoDeckId);

    // Two cards set aside → the player must order them.
    const pending = resolved.pendingResolutions.find(r => r.kind.type === 'arrange-deck-top');
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_2);
    expect((pending!.kind as { count: number }).count).toBe(2);

    assertEveryInstanceReachable(resolved);
  });

  test('the player orders the set-aside cards on top of the deck in the chosen order', () => {
    const deck = [HORN_OF_ANOR, CRAM, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HAUBERK_OF_BRIGHT_MAIL, BILBO, FRODO];
    const state = buildRevealed({
      hazardExtraHand: [CAVE_DRAKE, TWO_OR_THREE_TRIBES_PRESENT, GIMLI, STING],
      hazardDeck: deck,
    });
    const gimliId = findHandCardId(state, HAZARD_PLAYER, GIMLI);
    const stingId = findHandCardId(state, HAZARD_PLAYER, STING);
    const frodoDeckId = state.players[HAZARD_PLAYER].playDeck.find(c => c.definitionId === FRODO)!.instanceId;

    const resolved = playRevealed(state);

    // Both set-aside cards are offered as the next pick; the opponent waits.
    let choices = viableActions(resolved, PLAYER_2, 'arrange-deck-top-card')
      .map(a => (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId);
    expect(new Set(choices)).toEqual(new Set([gimliId, stingId]));
    expect(viableFor(resolved, PLAYER_1)).toHaveLength(0);

    // Place Sting on top first.
    const afterSting = dispatch(resolved, {
      type: 'arrange-deck-top-card', player: PLAYER_2, cardInstanceId: stingId,
    });
    // Still pending — only Gimli remains to be placed.
    expect(afterSting.pendingResolutions.some(r => r.kind.type === 'arrange-deck-top')).toBe(true);
    choices = viableActions(afterSting, PLAYER_2, 'arrange-deck-top-card')
      .map(a => (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId);
    expect(choices).toEqual([gimliId]);

    // Place Gimli — the ordering completes and the resolution clears.
    const afterGimli = dispatch(afterSting, {
      type: 'arrange-deck-top-card', player: PLAYER_2, cardInstanceId: gimliId,
    });
    expect(afterGimli.pendingResolutions.some(r => r.kind.type === 'arrange-deck-top')).toBe(false);

    // The deck top now matches the chosen order: Sting, then Gimli, then the
    // un-drawn card beneath.
    const finalDeck = afterGimli.players[HAZARD_PLAYER].playDeck;
    expect(finalDeck[0].instanceId).toBe(stingId);
    expect(finalDeck[1].instanceId).toBe(gimliId);
    expect(finalDeck[2].instanceId).toBe(frodoDeckId);
    assertEveryInstanceReachable(afterGimli);
  });

  test('with only one non-hazard set aside, no ordering is needed', () => {
    const deck = [HORN_OF_ANOR, CRAM, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HAUBERK_OF_BRIGHT_MAIL, BILBO, FRODO];
    const state = buildRevealed({ hazardExtraHand: [CAVE_DRAKE, GIMLI], hazardDeck: deck });
    const caveId = findHandCardId(state, HAZARD_PLAYER, CAVE_DRAKE);
    const gimliId = findHandCardId(state, HAZARD_PLAYER, GIMLI);

    const resolved = playRevealed(state);
    const hazard = resolved.players[HAZARD_PLAYER];

    // No ordering resolution — a single set-aside card has only one placement.
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'arrange-deck-top')).toBe(false);

    // Hand refilled to size (1 kept hazard + 7 draws); Gimli set aside on top.
    expect(hazard.hand).toHaveLength(HAND_SIZE);
    const handIds = hazard.hand.map(c => c.instanceId);
    expect(handIds).toContain(caveId);
    expect(handIds).not.toContain(gimliId);
    expect(hazard.playDeck).toHaveLength(1);
    expect(hazard.playDeck[0].instanceId).toBe(gimliId);
    assertEveryInstanceReachable(resolved);
  });

  test('a short play deck refills only what it can, losing no card', () => {
    // Deck of 3: need 6 to refill (2 hazards kept), so only 3 are drawn.
    const deck = [HORN_OF_ANOR, CRAM, THE_MITHRIL_COAT];
    const state = buildRevealed({
      hazardExtraHand: [CAVE_DRAKE, ORC_WARBAND, GIMLI, STING],
      hazardDeck: deck,
    });
    // Instance census before: P2 hand (5, incl. event) + deck (3) = 8.
    const before = new Set(
      [...state.players[HAZARD_PLAYER].hand, ...state.players[HAZARD_PLAYER].playDeck].map(c => c.instanceId),
    );
    const gimliId = findHandCardId(state, HAZARD_PLAYER, GIMLI);
    const stingId = findHandCardId(state, HAZARD_PLAYER, STING);

    const resolved = playRevealed(state);
    const hazard = resolved.players[HAZARD_PLAYER];

    // Only 3 draws available → 2 kept + 3 drawn = 5 (below hand size).
    expect(hazard.hand).toHaveLength(5);
    // Set-aside cards still land on top of the (now otherwise empty) deck.
    expect(hazard.playDeck).toHaveLength(2);
    expect(new Set(hazard.playDeck.map(c => c.instanceId))).toEqual(new Set([gimliId, stingId]));

    // No card instance disappeared: the 8 original cards are all still in
    // hand + deck + discard (the spent event), and each resolves.
    const after = new Set(
      [...hazard.hand, ...hazard.playDeck, ...hazard.discardPile].map(c => c.instanceId),
    );
    for (const id of before) expect(after.has(id)).toBe(true);
    assertEveryInstanceReachable(resolved);
  });
});
