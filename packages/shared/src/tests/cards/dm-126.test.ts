/**
 * @module dm-126.test
 *
 * Card test: Eyes of Mandos (dm-126)
 * Type: hero-resource-event (short), non-unique
 * Effects: 3
 *   1. play-window — restricts the card to the organization phase
 *   2. play-target — target character named "Pallando", cost: tap that character
 *   3. reveal-choose-shuffle — reveal top up-to-8, choose one to hand, shuffle rest
 *
 * Card text: "Playable on Pallando during the organization phase. Tap Pallando
 *  and reveal up to 8 cards from the top of your play deck. Choose one to put
 *  into your hand and shuffle the remaining ones into your play deck."
 *
 * Playing the card (only offered during the organization phase, only with an
 * untapped Pallando in play) taps Pallando, reveals the top up-to-8 cards of
 * the player's play deck to the opponent, and enqueues a `reveal-choose-to-hand`
 * pending resolution. The player then picks exactly one revealed card via a
 * `choose-revealed-card` action: it moves to their hand and the remaining play
 * deck is shuffled (folding the un-chosen revealed cards back in). The spent
 * event card is discarded on play.
 *
 * Engine Support:
 * | # | Feature                                            | Status      | Notes                                        |
 * |---|----------------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Playable only on Pallando during the org phase     | IMPLEMENTED | play-window + play-target filter target.name |
 * | 2 | Tap Pallando as the play cost                      | IMPLEMENTED | play-target cost { tap: character }           |
 * | 3 | Reveal top up-to-8 cards of the play deck          | IMPLEMENTED | reveal-choose-shuffle → revealInstances       |
 * | 4 | Choose one revealed card to put into hand         | IMPLEMENTED | reveal-choose-to-hand pending resolution      |
 * | 5 | Shuffle the remaining revealed cards into the deck | IMPLEMENTED | choose-revealed-card apply shuffles the deck  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, GANDALF,
  STING, GLAMDRING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  HAUBERK_OF_BRIGHT_MAIL, CRAM, SCROLL_OF_ISILDUR, PALANTIR_OF_ORTHANC, BILBO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, setCharStatus,
  viableActions, viableFor, findHandCardId, findCharInstanceId, dispatch,
  assertEveryInstanceReachable,
} from '../test-helpers.js';
import { Phase, CardStatus } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction, ChooseRevealedCardAction } from '../../index.js';

const EYES_OF_MANDOS = 'dm-126' as CardDefinitionId;
const PALLANDO = 'tw-175' as CardDefinitionId;

/** A 10-card play deck of distinct definitions (so revealed cards are identifiable). */
const DECK_10: CardDefinitionId[] = [
  STING, GLAMDRING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  HAUBERK_OF_BRIGHT_MAIL, CRAM, SCROLL_OF_ISILDUR, PALANTIR_OF_ORTHANC, BILBO,
];

/**
 * Build an organization-phase state with PLAYER_1 (resource) active. Pallando
 * (plus an optional extra character) sits at Rivendell holding Eyes of Mandos,
 * over a caller-supplied play deck.
 */
function buildEyes(opts: {
  avatar?: CardDefinitionId;
  deck?: CardDefinitionId[];
  extraChar?: CardDefinitionId;
}): GameState {
  const chars = [opts.avatar ?? PALLANDO, ...(opts.extraChar ? [opts.extraChar] : [])];
  return buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: chars }],
        hand: [EYES_OF_MANDOS],
        playDeck: opts.deck ?? DECK_10,
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
}

/** Find the play-short-event action for Eyes of Mandos (targeting Pallando). */
function eyesPlayAction(state: GameState): PlayShortEventAction {
  const cardId = findHandCardId(state, RESOURCE_PLAYER, EYES_OF_MANDOS);
  const ea = viableActions(state, PLAYER_1, 'play-short-event')
    .find(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
  expect(ea).toBeDefined();
  return ea!.action as PlayShortEventAction;
}

describe('Eyes of Mandos (dm-126)', () => {
  beforeEach(() => resetMint());

  test('playable on an untapped Pallando during the organization phase, targeting Pallando', () => {
    const state = buildEyes({ extraChar: ARAGORN });
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .map(a => a.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === findHandCardId(state, RESOURCE_PLAYER, EYES_OF_MANDOS));

    // Exactly one target offered: Pallando (never the company-mate Aragorn).
    expect(plays).toHaveLength(1);
    expect(plays[0].targetScoutInstanceId).toBe(pallandoId);
    expect(plays[0].targetScoutInstanceId).not.toBe(aragornId);
  });

  test('not playable without Pallando in play', () => {
    const state = buildEyes({ avatar: GANDALF });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, EYES_OF_MANDOS);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('not playable when Pallando is tapped (cannot pay the tap cost)', () => {
    const base = buildEyes({});
    const state = setCharStatus(base, RESOURCE_PLAYER, PALLANDO, CardStatus.Tapped);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, EYES_OF_MANDOS);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('not offered outside the organization phase (play-window)', () => {
    // Same fixture, but in the long-event phase: the play-window binds the card
    // to the organization phase, so it is not playable here.
    const state: GameState = { ...buildEyes({}), phaseState: { phase: Phase.LongEvent } as GameState['phaseState'] };
    const cardId = findHandCardId(state, RESOURCE_PLAYER, EYES_OF_MANDOS);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('playing it taps Pallando, reveals the top 8 cards, discards the event, and enqueues the choice', () => {
    const state = buildEyes({});
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, EYES_OF_MANDOS);
    const top8 = state.players[RESOURCE_PLAYER].playDeck.slice(0, 8).map(c => c.instanceId);

    const played = dispatch(state, eyesPlayAction(state));
    const p1 = played.players[RESOURCE_PLAYER];

    // Pallando is tapped; the event card left the hand for the discard pile.
    expect(p1.characters[pallandoId].status).toBe(CardStatus.Tapped);
    expect(p1.hand.some(c => c.instanceId === cardId)).toBe(false);
    expect(p1.discardPile.some(c => c.instanceId === cardId)).toBe(true);

    // The top 8 (of 10) cards were revealed to the opponent and stay on the deck.
    for (const id of top8) expect(played.revealedInstances[id]).toBeDefined();
    expect(p1.playDeck).toHaveLength(10);

    // A reveal-choose-to-hand resolution awaits PLAYER_1's mandatory pick.
    const pending = played.pendingResolutions.find(r => r.kind.type === 'reveal-choose-to-hand');
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_1);
    expect((pending!.kind as { revealedInstanceIds: readonly CardInstanceId[] }).revealedInstanceIds).toEqual(top8);

    // The player is offered exactly the 8 revealed cards; the opponent waits.
    const choices = viableActions(played, PLAYER_1, 'choose-revealed-card')
      .map(a => (a.action as ChooseRevealedCardAction).cardInstanceId);
    expect(new Set(choices)).toEqual(new Set(top8));
    expect(viableFor(played, PLAYER_2)).toHaveLength(0);

    assertEveryInstanceReachable(played);
  });

  test('choosing one revealed card puts it into hand and shuffles the rest back into the deck', () => {
    const state = buildEyes({});
    const top8 = state.players[RESOURCE_PLAYER].playDeck.slice(0, 8).map(c => c.instanceId);
    const bottomTwo = state.players[RESOURCE_PLAYER].playDeck.slice(8).map(c => c.instanceId);

    const played = dispatch(state, eyesPlayAction(state));
    const chosen = top8[3];
    const resolved = dispatch(played, {
      type: 'choose-revealed-card', player: PLAYER_1, cardInstanceId: chosen,
    });
    const p1 = resolved.players[RESOURCE_PLAYER];

    // Chosen card is now in hand and no longer in the play deck.
    expect(p1.hand.some(c => c.instanceId === chosen)).toBe(true);
    expect(p1.playDeck.some(c => c.instanceId === chosen)).toBe(false);

    // The 9 remaining cards (7 un-chosen revealed + 2 that were beneath) are all
    // still in the play deck — nothing lost, the resolution is cleared.
    expect(p1.playDeck).toHaveLength(9);
    const deckIds = new Set(p1.playDeck.map(c => c.instanceId as string));
    for (const id of top8) if (id !== chosen) expect(deckIds.has(id as string)).toBe(true);
    for (const id of bottomTwo) expect(deckIds.has(id as string)).toBe(true);
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'reveal-choose-to-hand')).toBe(false);

    assertEveryInstanceReachable(resolved);
  });

  test('reveals only what a short deck holds and folds the rest back on choice', () => {
    const shortDeck = [STING, GLAMDRING, THE_MITHRIL_COAT];
    const state = buildEyes({ deck: shortDeck });
    const allThree = state.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId);

    const played = dispatch(state, eyesPlayAction(state));
    const pending = played.pendingResolutions.find(r => r.kind.type === 'reveal-choose-to-hand');
    expect(pending).toBeDefined();
    // Only 3 cards are available, so only 3 are revealed (not a full 8).
    expect((pending!.kind as { revealedInstanceIds: readonly CardInstanceId[] }).revealedInstanceIds).toEqual(allThree);

    const chosen = allThree[0];
    const resolved = dispatch(played, {
      type: 'choose-revealed-card', player: PLAYER_1, cardInstanceId: chosen,
    });
    const p1 = resolved.players[RESOURCE_PLAYER];
    expect(p1.hand.some(c => c.instanceId === chosen)).toBe(true);
    expect(p1.playDeck).toHaveLength(2);
    expect(p1.playDeck.some(c => c.instanceId === chosen)).toBe(false);
    assertEveryInstanceReachable(resolved);
  });

  test('with an empty play deck the event fizzles (Pallando tapped, event spent, no choice)', () => {
    const state = buildEyes({ deck: [] });
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, EYES_OF_MANDOS);

    const played = dispatch(state, eyesPlayAction(state));
    const p1 = played.players[RESOURCE_PLAYER];

    expect(p1.characters[pallandoId].status).toBe(CardStatus.Tapped);
    expect(p1.discardPile.some(c => c.instanceId === cardId)).toBe(true);
    expect(played.pendingResolutions.some(r => r.kind.type === 'reveal-choose-to-hand')).toBe(false);
    assertEveryInstanceReachable(played);
  });
});
