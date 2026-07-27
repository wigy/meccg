/**
 * @module tw-282.test
 *
 * Card test: Mirror of Galadriel (tw-282)
 * Type: hero-resource-event (short), non-unique, 0 MP.
 * Effects: 2
 *   1. play-condition player-state — `player.characterSiteNames` includes "Lórien"
 *   2. peek-shuffle-deck-top — count 5, revealOpponentHand, deckChoice "any"
 *
 * Card text: "Only playable if any of your characters are at Lórien. You may
 *  look at your opponent's hand and then choose to look at the top five cards
 *  of any one play deck. Shuffle those 5 cards and return them to the top of
 *  their play deck."
 *
 * Playing it discards the event, reveals the opponent's whole hand to the
 * card-player, and enqueues a `choose-peek-deck` pending resolution so the deck
 * is chosen *after* the hand has been seen. The player answers with
 * `choose-peek-deck` naming their own or the opponent's deck — whose top five
 * cards are then shuffled and returned to the top — or declines with `pass`
 * ("You **may** … choose to look at …"). Following the certified Palantír of
 * Minas Tirith (tw-299 / le-333), the deck look is modelled as the shuffle
 * alone: `revealedInstances` is public to both players, so recording the peeked
 * deck cards there would show them to the player who may not see them.
 *
 * Engine Support:
 * | # | Feature                                             | Status      | Notes                                              |
 * |---|-----------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Only playable with a character at Lórien            | IMPLEMENTED | play-condition player-state, player.characterSiteNames |
 * | 2 | Look at the opponent's hand                         | IMPLEMENTED | peek-shuffle-deck-top revealOpponentHand → revealInstances |
 * | 3 | Then choose any one play deck (own or opponent's)   | IMPLEMENTED | choose-peek-deck pending resolution, deckChoice "any" |
 * | 4 | Look at that deck's top five and shuffle them back  | IMPLEMENTED | applyChoosePeekDeckResolution shuffles top `count` in place |
 * | 5 | The whole look is optional ("You may …")            | IMPLEMENTED | pass is always offered on the pending resolution    |
 * | 6 | An in-play cancel-deck-search withholds your own deck | IMPLEMENTED | deckSearchCancellerFor — Bane of the Ithil-stone tw-13 |
 *
 * Fixture alignment: hero-resource-event (wizard); hero characters (TW) and
 * hero sites (TW) on both sides.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GIMLI, GANDALF, BILBO,
  STING, GLAMDRING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  HAUBERK_OF_BRIGHT_MAIL, SCROLL_OF_ISILDUR,
  LORIEN, RIVENDELL, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, addCardInPlay,
  viableActions, viableFor, findHandCardId, dispatch,
  assertEveryInstanceReachable,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, GameState, PlayShortEventAction, ChoosePeekDeckAction } from '../../index.js';

const MIRROR_OF_GALADRIEL = 'tw-282' as CardDefinitionId;
const BANE_OF_THE_ITHIL_STONE = 'tw-13' as CardDefinitionId; // cancel-deck-search, affects non-minion

/** A 7-card play deck of distinct definitions, so the top five are identifiable. */
const DECK_7: CardDefinitionId[] = [
  STING, GLAMDRING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  HAUBERK_OF_BRIGHT_MAIL, SCROLL_OF_ISILDUR,
];

/** A distinct 7-card deck for the opponent, so the two decks never alias. */
const OPP_DECK_7: CardDefinitionId[] = [
  SCROLL_OF_ISILDUR, HAUBERK_OF_BRIGHT_MAIL, HORN_OF_ANOR, DAGGER_OF_WESTERNESSE,
  THE_MITHRIL_COAT, GLAMDRING, STING,
];

/**
 * Build an organization-phase state with PLAYER_1 (resource) active, holding
 * Mirror of Galadriel. `sites` lists one site per PLAYER_1 company (each gets a
 * single character); the opponent sits at Rivendell with a three-card hand.
 */
function buildMirror(opts: {
  sites?: CardDefinitionId[];
  deck?: CardDefinitionId[];
  opponentDeck?: CardDefinitionId[];
  opponentHand?: CardDefinitionId[];
}): GameState {
  const sites = opts.sites ?? [LORIEN];
  const chars = [ARAGORN, LEGOLAS, GIMLI];
  return buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: sites.map((site, i) => ({ site, characters: [chars[i]] })),
        hand: [MIRROR_OF_GALADRIEL],
        playDeck: opts.deck ?? DECK_7,
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [GANDALF] }],
        hand: opts.opponentHand ?? [STING, GLAMDRING, BILBO],
        playDeck: opts.opponentDeck ?? OPP_DECK_7,
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

  // ─── "Only playable if any of your characters are at Lórien" ──────────────

  test('playable while a character is at Lórien', () => {
    const state = buildMirror({ sites: [LORIEN] });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, MIRROR_OF_GALADRIEL);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(1);
  });

  test('NOT playable when none of your characters are at Lórien', () => {
    const state = buildMirror({ sites: [RIVENDELL] });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, MIRROR_OF_GALADRIEL);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('"any of your characters" — a second company at Lórien is enough', () => {
    const state = buildMirror({ sites: [RIVENDELL, MORIA, LORIEN] });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, MIRROR_OF_GALADRIEL);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(1);
  });

  test('the opponent being at Lórien does not make it playable', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [MIRROR_OF_GALADRIEL],
          playDeck: DECK_7,
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GANDALF] }],
          hand: [STING],
          playDeck: OPP_DECK_7,
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, MIRROR_OF_GALADRIEL);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  // ─── "You may look at your opponent's hand …" ─────────────────────────────

  test('playing it discards the event, reveals the opponent hand, and asks which deck', () => {
    const state = buildMirror({});
    const cardId = findHandCardId(state, RESOURCE_PLAYER, MIRROR_OF_GALADRIEL);
    const oppHandIds = state.players[HAZARD_PLAYER].hand.map(c => c.instanceId);
    expect(oppHandIds).toHaveLength(3);
    for (const id of oppHandIds) expect(state.revealedInstances[id]).toBeUndefined();

    const played = dispatch(state, mirrorPlayAction(state));

    // The spent event card left the hand for the discard pile.
    const p1 = played.players[RESOURCE_PLAYER];
    expect(p1.hand.some(c => c.instanceId === cardId)).toBe(false);
    expect(p1.discardPile.some(c => c.instanceId === cardId)).toBe(true);

    // Every card of the opponent's hand is now known — and stays in their hand.
    for (const id of oppHandIds) expect(played.revealedInstances[id]).toBeDefined();
    expect(played.players[HAZARD_PLAYER].hand.map(c => c.instanceId)).toEqual(oppHandIds);

    // The deck choice awaits PLAYER_1; the opponent has nothing to do.
    const pending = played.pendingResolutions.find(r => r.kind.type === 'choose-peek-deck');
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_1);
    expect(pending!.kind).toMatchObject({ count: 5, deckChoice: 'any' });
    expect(viableFor(played, PLAYER_2)).toHaveLength(0);

    assertEveryInstanceReachable(played);
  });

  // ─── "… and then choose to look at the top five cards of any one play deck" ─

  test('both play decks are offered as choices, plus declining the look', () => {
    const state = buildMirror({});
    const played = dispatch(state, mirrorPlayAction(state));
    const owners = viableActions(played, PLAYER_1, 'choose-peek-deck')
      .map(a => (a.action as ChoosePeekDeckAction).deckOwner);
    expect(new Set(owners)).toEqual(new Set(['self', 'opponent']));
    expect(viableActions(played, PLAYER_1, 'pass')).toHaveLength(1);
  });

  test('only decks that hold cards are offered', () => {
    const state = buildMirror({ deck: [] });
    const played = dispatch(state, mirrorPlayAction(state));
    const owners = viableActions(played, PLAYER_1, 'choose-peek-deck')
      .map(a => (a.action as ChoosePeekDeckAction).deckOwner);
    expect(owners).toEqual(['opponent']);
  });

  test('choosing the opponent deck shuffles its top five and leaves the rest alone', () => {
    const state = buildMirror({});
    const played = dispatch(state, mirrorPlayAction(state));
    const ownBefore = played.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId);
    const oppBefore = played.players[HAZARD_PLAYER].playDeck;

    const resolved = dispatch(played, {
      type: 'choose-peek-deck', player: PLAYER_1, deckOwner: 'opponent',
    });
    const oppAfter = resolved.players[HAZARD_PLAYER].playDeck;

    // Same 7 cards; the top five are the same set, still on top.
    expect(oppAfter).toHaveLength(7);
    expect(new Set(oppAfter.slice(0, 5).map(c => c.instanceId as string)))
      .toEqual(new Set(oppBefore.slice(0, 5).map(c => c.instanceId as string)));
    // Cards beneath the top five never move.
    expect(oppAfter.slice(5).map(c => c.instanceId)).toEqual(oppBefore.slice(5).map(c => c.instanceId));
    // The card-player's own deck is untouched — only one deck was chosen.
    expect(resolved.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId)).toEqual(ownBefore);

    expect(resolved.pendingResolutions.some(r => r.kind.type === 'choose-peek-deck')).toBe(false);
    assertEveryInstanceReachable(resolved);
  });

  test('choosing your own deck shuffles your own top five and leaves the opponent alone', () => {
    const state = buildMirror({});
    const played = dispatch(state, mirrorPlayAction(state));
    const ownBefore = played.players[RESOURCE_PLAYER].playDeck;
    const oppBefore = played.players[HAZARD_PLAYER].playDeck.map(c => c.instanceId);

    const resolved = dispatch(played, {
      type: 'choose-peek-deck', player: PLAYER_1, deckOwner: 'self',
    });
    const ownAfter = resolved.players[RESOURCE_PLAYER].playDeck;

    expect(ownAfter).toHaveLength(7);
    expect(new Set(ownAfter.slice(0, 5).map(c => c.instanceId as string)))
      .toEqual(new Set(ownBefore.slice(0, 5).map(c => c.instanceId as string)));
    expect(ownAfter.slice(5).map(c => c.instanceId)).toEqual(ownBefore.slice(5).map(c => c.instanceId));
    expect(resolved.players[HAZARD_PLAYER].playDeck.map(c => c.instanceId)).toEqual(oppBefore);

    expect(resolved.pendingResolutions.some(r => r.kind.type === 'choose-peek-deck')).toBe(false);
    assertEveryInstanceReachable(resolved);
  });

  test('a deck shorter than five is shuffled whole', () => {
    const shortDeck = [STING, GLAMDRING, THE_MITHRIL_COAT];
    const state = buildMirror({ opponentDeck: shortDeck });
    const played = dispatch(state, mirrorPlayAction(state));
    const oppBefore = played.players[HAZARD_PLAYER].playDeck.map(c => c.instanceId as string);

    const resolved = dispatch(played, {
      type: 'choose-peek-deck', player: PLAYER_1, deckOwner: 'opponent',
    });
    const oppAfter = resolved.players[HAZARD_PLAYER].playDeck.map(c => c.instanceId as string);
    expect(oppAfter).toHaveLength(3);
    expect(new Set(oppAfter)).toEqual(new Set(oppBefore));
    assertEveryInstanceReachable(resolved);
  });

  test('declining the look ("you may") leaves both decks exactly as they were', () => {
    const state = buildMirror({});
    const played = dispatch(state, mirrorPlayAction(state));
    const ownBefore = played.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId);
    const oppBefore = played.players[HAZARD_PLAYER].playDeck.map(c => c.instanceId);

    const resolved = dispatch(played, { type: 'pass', player: PLAYER_1 });

    expect(resolved.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId)).toEqual(ownBefore);
    expect(resolved.players[HAZARD_PLAYER].playDeck.map(c => c.instanceId)).toEqual(oppBefore);
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'choose-peek-deck')).toBe(false);
    assertEveryInstanceReachable(resolved);
  });

  test('Bane of the Ithil-stone withholds your own deck but not the opponent\'s', () => {
    // tw-13 carries cancel-deck-search { affects: "non-minion" }: it cancels a
    // Wizard's look at HIS OWN play deck, and does not reach the opponent's.
    const state = addCardInPlay(buildMirror({}), HAZARD_PLAYER, BANE_OF_THE_ITHIL_STONE);

    const played = dispatch(state, mirrorPlayAction(state));
    const owners = viableActions(played, PLAYER_1, 'choose-peek-deck')
      .map(a => (a.action as ChoosePeekDeckAction).deckOwner);
    expect(owners).toEqual(['opponent']);

    // The opponent's deck is still fair game and shuffles normally.
    const oppBefore = played.players[HAZARD_PLAYER].playDeck;
    const resolved = dispatch(played, {
      type: 'choose-peek-deck', player: PLAYER_1, deckOwner: 'opponent',
    });
    const oppAfter = resolved.players[HAZARD_PLAYER].playDeck;
    expect(new Set(oppAfter.slice(0, 5).map(c => c.instanceId as string)))
      .toEqual(new Set(oppBefore.slice(0, 5).map(c => c.instanceId as string)));
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'choose-peek-deck')).toBe(false);
    assertEveryInstanceReachable(resolved);
  });

  test('with both play decks empty the hand is still seen and no deck choice is asked', () => {
    const state = buildMirror({ deck: [], opponentDeck: [] });
    const oppHandIds = state.players[HAZARD_PLAYER].hand.map(c => c.instanceId);

    const played = dispatch(state, mirrorPlayAction(state));

    for (const id of oppHandIds) expect(played.revealedInstances[id]).toBeDefined();
    expect(played.pendingResolutions.some(r => r.kind.type === 'choose-peek-deck')).toBe(false);
    assertEveryInstanceReachable(played);
  });

  test('an empty opponent hand reveals nothing but the deck choice still runs', () => {
    const state = buildMirror({ opponentHand: [] });
    const played = dispatch(state, mirrorPlayAction(state));

    expect(played.players[HAZARD_PLAYER].hand).toHaveLength(0);
    const pending = played.pendingResolutions.find(r => r.kind.type === 'choose-peek-deck');
    expect(pending).toBeDefined();
    assertEveryInstanceReachable(played);
  });
});
