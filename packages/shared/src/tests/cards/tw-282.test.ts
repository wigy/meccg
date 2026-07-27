/**
 * @module tw-282.test
 *
 * Card test: Mirror of Galadriel (tw-282)
 * Type: hero-resource-event (short), non-unique, 0 MP
 * Effects: 3
 *   1. play-condition player-state — `player.characterSiteNames` includes "Lórien"
 *   2. reveal-opponent-hand — the opponent's whole hand is seen by the player
 *   3. peek-deck-top (count 5) — choose one play deck, look at its top 5,
 *      shuffle those 5 and return them to the top of that deck
 *
 * Card text: "Only playable if any of your characters are at Lórien. You may
 *  look at your opponent's hand and then choose to look at the top five cards
 *  of any one play deck. Shuffle those 5 cards and return them to the top of
 *  their play deck."
 *
 * Playing the card (offered only while the player has a character at Lórien)
 * discards the event, records every card in the opponent's hand as seen, and
 * enqueues a `peek-deck-top` pending resolution offering one `choose-peek-deck`
 * action per non-empty candidate play deck. Resolving it reveals the top five
 * cards of the chosen deck to the player, shuffles exactly those five, and puts
 * them back on top — deck size and the cards beneath the slice are untouched.
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                                             |
 * |---|------------------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | Only playable with a character at Lórien             | IMPLEMENTED | play-condition player-state characterSiteNames    |
 * | 2 | Look at the opponent's hand                          | IMPLEMENTED | reveal-opponent-hand → revealedInstances          |
 * | 3 | Choose any one play deck                             | IMPLEMENTED | peek-deck-top pending → choose-peek-deck actions  |
 * | 4 | Look at that deck's top five cards                   | IMPLEMENTED | peek slice recorded in revealedInstances          |
 * | 5 | Shuffle those five and return them to the deck top   | IMPLEMENTED | applyPeekDeckTopResolution shuffles the slice     |
 * | 6 | Own-deck look barred by cancel-deck-search           | IMPLEMENTED | deckSearchCancellerFor gates the self arm         |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, GANDALF, LEGOLAS,
  STING, GLAMDRING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  HAUBERK_OF_BRIGHT_MAIL, CRAM, SCROLL_OF_ISILDUR, PALANTIR_OF_ORTHANC, BILBO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, addCardInPlay,
  viableActions, viableFor, findHandCardId, dispatch,
  assertEveryInstanceReachable,
} from '../test-helpers.js';
import { Phase, reduce } from '../../index.js';
import type { CardDefinitionId, GameState, PlayShortEventAction, ChoosePeekDeckAction } from '../../index.js';

const MIRROR_OF_GALADRIEL = 'tw-282' as CardDefinitionId;
/** Bane of the Ithil-stone — cancels a non-minion player's own-deck searches. */
const BANE_OF_THE_ITHIL_STONE = 'tw-13' as CardDefinitionId;

/** A 10-card play deck of distinct definitions (so peeked cards are identifiable). */
const DECK_10: CardDefinitionId[] = [
  STING, GLAMDRING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  HAUBERK_OF_BRIGHT_MAIL, CRAM, SCROLL_OF_ISILDUR, PALANTIR_OF_ORTHANC, BILBO,
];

/** A distinct 10-card deck for the opponent, so the two decks never overlap. */
const OPPONENT_DECK_10: CardDefinitionId[] = [
  BILBO, PALANTIR_OF_ORTHANC, SCROLL_OF_ISILDUR, CRAM, HAUBERK_OF_BRIGHT_MAIL,
  HORN_OF_ANOR, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT, GLAMDRING, STING,
];

/**
 * Organization-phase state with PLAYER_1 (resource) active, holding Mirror of
 * Galadriel. `site` is where PLAYER_1's company stands; `extraSite`, when given,
 * adds a second company there (used to check that *any* company at Lórien
 * satisfies the gate).
 */
function buildMirror(opts: {
  site?: CardDefinitionId;
  extraSite?: CardDefinitionId;
  opponentSite?: CardDefinitionId;
  deck?: CardDefinitionId[];
  opponentDeck?: CardDefinitionId[];
  opponentHand?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [
          { site: opts.site ?? LORIEN, characters: [GANDALF] },
          ...(opts.extraSite ? [{ site: opts.extraSite, characters: [LEGOLAS] }] : []),
        ],
        hand: [MIRROR_OF_GALADRIEL],
        playDeck: opts.deck ?? DECK_10,
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        companies: [{ site: opts.opponentSite ?? RIVENDELL, characters: [ARAGORN] }],
        hand: opts.opponentHand ?? [STING, GLAMDRING, CRAM],
        playDeck: opts.opponentDeck ?? OPPONENT_DECK_10,
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
}

/** The `play-short-event` action for Mirror of Galadriel. */
function mirrorPlayAction(state: GameState): PlayShortEventAction {
  const cardId = findHandCardId(state, RESOURCE_PLAYER, MIRROR_OF_GALADRIEL);
  const ea = viableActions(state, PLAYER_1, 'play-short-event')
    .find(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
  expect(ea).toBeDefined();
  return ea!.action as PlayShortEventAction;
}

describe('Mirror of Galadriel (tw-282)', () => {
  beforeEach(() => resetMint());

  test('not playable while no character of yours is at Lórien', () => {
    const state = buildMirror({ site: RIVENDELL });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, MIRROR_OF_GALADRIEL);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('playable when any one of your companies stands at Lórien', () => {
    // The Lórien company is the *second* one — "any of your characters".
    const state = buildMirror({ site: RIVENDELL, extraSite: LORIEN });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, MIRROR_OF_GALADRIEL);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(1);
  });

  test('only your own characters count — the opponent at Lórien does not open the gate', () => {
    const state = buildMirror({ site: RIVENDELL, opponentSite: LORIEN });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, MIRROR_OF_GALADRIEL);
    expect(
      viableActions(state, PLAYER_1, 'play-short-event')
        .filter(a => (a.action as PlayShortEventAction).cardInstanceId === cardId),
    ).toHaveLength(0);
  });

  test("playing it reveals the opponent's whole hand and asks which deck to look at", () => {
    const state = buildMirror({});
    const cardId = findHandCardId(state, RESOURCE_PLAYER, MIRROR_OF_GALADRIEL);
    const oppHandIds = state.players[HAZARD_PLAYER].hand.map(c => c.instanceId);
    expect(oppHandIds).toHaveLength(3);

    const played = dispatch(state, mirrorPlayAction(state));

    // The spent event left the hand for the discard pile.
    expect(played.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === cardId)).toBe(false);
    expect(played.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(true);

    // Every card the opponent held is now seen — and stays in their hand.
    for (const id of oppHandIds) expect(played.revealedInstances[id]).toBeDefined();
    expect(played.players[HAZARD_PLAYER].hand.map(c => c.instanceId)).toEqual(oppHandIds);

    // A peek-deck-top resolution awaits PLAYER_1's choice of deck; both decks
    // are on offer ("any one play deck") and the opponent has nothing to do.
    const pending = played.pendingResolutions.find(r => r.kind.type === 'peek-deck-top');
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_1);
    expect((pending!.kind as { count: number }).count).toBe(5);
    const offered = viableActions(played, PLAYER_1, 'choose-peek-deck')
      .map(a => (a.action as ChoosePeekDeckAction).deckOwner);
    expect(new Set(offered)).toEqual(new Set([PLAYER_1, PLAYER_2]));
    expect(viableFor(played, PLAYER_2)).toHaveLength(0);

    assertEveryInstanceReachable(played);
  });

  test("looking at the opponent's deck reveals its top five and shuffles them back on top", () => {
    const state = buildMirror({});
    const before = state.players[HAZARD_PLAYER].playDeck.map(c => c.instanceId);
    const topFive = before.slice(0, 5);
    const beneath = before.slice(5);

    const played = dispatch(state, mirrorPlayAction(state));
    const resolved = dispatch(played, {
      type: 'choose-peek-deck', player: PLAYER_1, deckOwner: PLAYER_2,
    });
    const after = resolved.players[HAZARD_PLAYER].playDeck.map(c => c.instanceId);

    // The five are seen by the player…
    for (const id of topFive) expect(resolved.revealedInstances[id]).toBeDefined();
    // …and returned to the top of the same deck: same five up top (in some
    // order), same cards beneath in the same order, same deck size.
    expect(after).toHaveLength(before.length);
    expect(new Set(after.slice(0, 5))).toEqual(new Set(topFive));
    expect(after.slice(5)).toEqual(beneath);

    // The look does not move a card anywhere: nothing entered anyone's hand.
    expect(resolved.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expect(resolved.players[HAZARD_PLAYER].hand).toHaveLength(3);
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'peek-deck-top')).toBe(false);

    assertEveryInstanceReachable(resolved);
  });

  test('the five looked-at cards really are shuffled, not left in printed order', () => {
    const state = buildMirror({});
    const topFive = state.players[HAZARD_PLAYER].playDeck.slice(0, 5).map(c => c.instanceId);

    const played = dispatch(state, mirrorPlayAction(state));
    const resolved = dispatch(played, {
      type: 'choose-peek-deck', player: PLAYER_1, deckOwner: PLAYER_2,
    });
    const after = resolved.players[HAZARD_PLAYER].playDeck.slice(0, 5).map(c => c.instanceId);
    expect(after).not.toEqual(topFive);
  });

  test('the player may look at his own play deck instead', () => {
    const state = buildMirror({});
    const before = state.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId);

    const played = dispatch(state, mirrorPlayAction(state));
    const resolved = dispatch(played, {
      type: 'choose-peek-deck', player: PLAYER_1, deckOwner: PLAYER_1,
    });
    const after = resolved.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId);

    for (const id of before.slice(0, 5)) expect(resolved.revealedInstances[id]).toBeDefined();
    expect(new Set(after.slice(0, 5))).toEqual(new Set(before.slice(0, 5)));
    expect(after.slice(5)).toEqual(before.slice(5));
    // The opponent's deck was left completely alone.
    expect(resolved.players[HAZARD_PLAYER].playDeck.map(c => c.instanceId))
      .toEqual(state.players[HAZARD_PLAYER].playDeck.map(c => c.instanceId));

    assertEveryInstanceReachable(resolved);
  });

  test('a deck shorter than five is looked at in full and stays intact', () => {
    const shortDeck = [STING, GLAMDRING, THE_MITHRIL_COAT];
    const state = buildMirror({ opponentDeck: shortDeck });
    const before = state.players[HAZARD_PLAYER].playDeck.map(c => c.instanceId);

    const played = dispatch(state, mirrorPlayAction(state));
    const resolved = dispatch(played, {
      type: 'choose-peek-deck', player: PLAYER_1, deckOwner: PLAYER_2,
    });
    const after = resolved.players[HAZARD_PLAYER].playDeck.map(c => c.instanceId);

    for (const id of before) expect(resolved.revealedInstances[id]).toBeDefined();
    expect(new Set(after)).toEqual(new Set(before));
    expect(after).toHaveLength(3);
    assertEveryInstanceReachable(resolved);
  });

  test('an empty play deck is not offered as a choice', () => {
    const state = buildMirror({ opponentDeck: [] });
    const played = dispatch(state, mirrorPlayAction(state));
    const offered = viableActions(played, PLAYER_1, 'choose-peek-deck')
      .map(a => (a.action as ChoosePeekDeckAction).deckOwner);
    expect(offered).toEqual([PLAYER_1]);
  });

  test('with both play decks empty the choice passes and nothing is looked at', () => {
    const state = buildMirror({ deck: [], opponentDeck: [] });
    const played = dispatch(state, mirrorPlayAction(state));
    expect(viableActions(played, PLAYER_1, 'choose-peek-deck')).toHaveLength(0);
    expect(viableActions(played, PLAYER_1, 'pass')).toHaveLength(1);

    const resolved = dispatch(played, { type: 'pass', player: PLAYER_1 });
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'peek-deck-top')).toBe(false);
    assertEveryInstanceReachable(resolved);
  });

  test("Bane of the Ithil-stone bars the own-deck look but not the opponent's", () => {
    // "Automatically cancels any effect that causes a player to search through
    // or look at any portion of a play deck … outside of the normal sequence of
    // play" — the cancel covers a player's OWN deck, so the opponent's deck is
    // still fair game.
    const state = addCardInPlay(buildMirror({}), HAZARD_PLAYER, BANE_OF_THE_ITHIL_STONE);
    const played = dispatch(state, mirrorPlayAction(state));

    const offered = viableActions(played, PLAYER_1, 'choose-peek-deck')
      .map(a => (a.action as ChoosePeekDeckAction).deckOwner);
    expect(offered).toEqual([PLAYER_2]);

    // The opponent's hand was still revealed — Bane only guards play decks.
    for (const c of played.players[HAZARD_PLAYER].hand) {
      expect(played.revealedInstances[c.instanceId]).toBeDefined();
    }
  });

  test('a barred own-deck choice is rejected by the reducer, not merely hidden', () => {
    const state = addCardInPlay(buildMirror({}), HAZARD_PLAYER, BANE_OF_THE_ITHIL_STONE);
    const played = dispatch(state, mirrorPlayAction(state));
    const ownDeckBefore = played.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId);

    // Forging the un-offered action is refused: the deck is untouched and the
    // choice is still open.
    const { state: forged, error } = reduce(played, {
      type: 'choose-peek-deck', player: PLAYER_1, deckOwner: PLAYER_1,
    });
    expect(error).toBeDefined();
    expect(forged.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId)).toEqual(ownDeckBefore);
    expect(forged.pendingResolutions.some(r => r.kind.type === 'peek-deck-top')).toBe(true);
  });

  test('an empty opponent hand reveals nothing but the deck look still happens', () => {
    const state = buildMirror({ opponentHand: [] });
    const played = dispatch(state, mirrorPlayAction(state));
    expect(played.players[HAZARD_PLAYER].hand).toHaveLength(0);

    const resolved = dispatch(played, {
      type: 'choose-peek-deck', player: PLAYER_1, deckOwner: PLAYER_2,
    });
    const topFive = state.players[HAZARD_PLAYER].playDeck.slice(0, 5).map(c => c.instanceId);
    for (const id of topFive) expect(resolved.revealedInstances[id]).toBeDefined();
    assertEveryInstanceReachable(resolved);
  });
});
