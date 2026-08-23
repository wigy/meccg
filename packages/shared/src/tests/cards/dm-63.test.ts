/**
 * @module dm-63.test
 *
 * Card test: Great Secrets Buried There (dm-63)
 * Type: hazard-event (permanent), non-unique
 *
 * Card text: "Playable if opponent has at least ten cards in his play deck.
 * Opponent reveals the top ten cards of his play deck to himself. If one is
 * available, opponent must choose a non-special, non-hoard item from the
 * revealed cards to place off to the side under this card (item does not give
 * marshalling points and is considered out of play). If none are available,
 * opponent must show you the cards he revealed to himself. Opponent shuffles
 * all remaining revealed cards into his play deck. Opponent may play this item
 * as though it were in his hand at any Under-deeps site where it could be
 * normally playable. Alternatively, you may play this card as a resource on
 * yourself if you have at least ten cards in your play deck. In this case, you
 * and your opponent reverse roles."
 *
 * Effects (data):
 *   - play-condition, requires: active-player-deck-size, minDeckSize: 10
 *   - play-flag: playable-as-resource
 *   - reveal-deck-choose-set-aside, count: 10, itemFilter: non-special/non-hoard item
 *
 * Engine support:
 * | # | Rule                                                          | Status |
 * |---|----------------------------------------------------------------|--------|
 * | 1 | Playable as a hazard only if the active player has 10+ deck   | OK     |
 * | 2 | Reveals top 10, deck owner chooses one eligible item to set   | OK     |
 * |   | aside; remainder shuffled back                                |        |
 * | 3 | Set-aside item scores no marshalling points                   | OK     |
 * | 4 | No eligible item: cards shown, all shuffled back, no host mp  | OK     |
 * | 5 | Alternate resource-on-self mode reverses roles                | OK     |
 * | 6 | Set-aside item playable "as though in hand" at Under-deeps    | OK     |
 *
 * Player-index convention: PLAYER_1/RESOURCE_PLAYER is the active (resource)
 * player whose deck/company is being hazarded; PLAYER_2/HAZARD_PLAYER plays
 * Great Secrets Buried There against them.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  STING, GLAMDRING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  HAUBERK_OF_BRIGHT_MAIL, CRAM, SCROLL_OF_ISILDUR, PALANTIR_OF_ORTHANC, BILBO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, buildSitePhaseState, resetMint, makeMHState,
  viableActions, findHandCardId, companyIdAt,
  playHazardAndResolve, playPermanentEventAndResolve, dispatch,
  assertEveryInstanceReachable,
} from '../test-helpers.js';
import { Phase, CardStatus } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState,
  PlayPermanentEventAction, PlayHeroResourceAction, ChooseSetAsideItemAction,
} from '../../index.js';

const GREAT_SECRETS = 'dm-63' as CardDefinitionId;
const UNDER_GATES = 'dm-38' as CardDefinitionId; // hero Under-deeps site, shadow-hold, playable minor/major/greater/gold-ring

/** A 10-card play deck: 8 eligible (non-special, non-hoard) items, 1 special item, 1 character. */
const DECK_10: CardDefinitionId[] = [
  STING, GLAMDRING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  HAUBERK_OF_BRIGHT_MAIL, CRAM, SCROLL_OF_ISILDUR, PALANTIR_OF_ORTHANC, BILBO,
];

/** Build an M/H-phase state: P1's company (untargeted by the card) vs. P2 holding the card. */
function buildHazardState(opts: { p1Deck?: CardDefinitionId[] } = {}): GameState {
  const state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], playDeck: opts.p1Deck ?? DECK_10, siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GREAT_SECRETS], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

describe('Great Secrets Buried There (dm-63)', () => {
  beforeEach(() => resetMint());

  // ── #1: deck-size gate (hazard mode) ────────────────────────────────────────

  test('not playable as a hazard when the active player has fewer than 10 cards in his play deck', () => {
    const state = buildHazardState({ p1Deck: [STING, GLAMDRING, THE_MITHRIL_COAT] });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('playable as a hazard once the active player has exactly 10 cards in his play deck', () => {
    const state = buildHazardState();
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(1);
  });

  // ── #2/#3: reveal, choose, set aside, no marshalling points ─────────────────

  test('playing it as a hazard reveals the top 10 and enqueues a choice for the deck owner (P1)', () => {
    const state = buildHazardState();
    const top10 = state.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId);
    const cardId = findHandCardId(state, HAZARD_PLAYER, GREAT_SECRETS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const played = playHazardAndResolve(state, PLAYER_2, cardId, companyId);

    // All 10 cards revealed; still physically on top of P1's deck.
    for (const id of top10) expect(played.revealedInstances[id]).toBeDefined();
    expect(played.players[RESOURCE_PLAYER].playDeck).toHaveLength(10);

    // The host entered P2's cardsInPlay (general permanent-event placement).
    expect(played.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === GREAT_SECRETS)).toBe(true);

    // A great-secrets-choose-item resolution awaits P1 (the deck owner), not P2.
    const pending = played.pendingResolutions.find(r => r.kind.type === 'great-secrets-choose-item');
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_1);
    const kind = pending!.kind as {
      revealedInstanceIds: readonly CardInstanceId[];
      eligibleInstanceIds: readonly CardInstanceId[];
      deckOwnerId: string;
    };
    expect(kind.revealedInstanceIds).toEqual(top10);
    expect(kind.deckOwnerId).toBe(PLAYER_1);
    // 8 eligible items (everything except the special Palantír and Bilbo the character).
    expect(kind.eligibleInstanceIds).toHaveLength(8);

    // Only P1 may choose; P2 (the card-player) waits.
    const choices = viableActions(played, PLAYER_1, 'choose-set-aside-item')
      .map(a => (a.action as ChooseSetAsideItemAction).cardInstanceId);
    expect(new Set(choices)).toEqual(new Set(kind.eligibleInstanceIds));
    expect(viableActions(played, PLAYER_2, 'choose-set-aside-item')).toHaveLength(0);

    assertEveryInstanceReachable(played);
  });

  test('choosing an eligible item sets it aside under the host, shuffles the rest back, and scores no MP', () => {
    const state = buildHazardState();
    const cardId = findHandCardId(state, HAZARD_PLAYER, GREAT_SECRETS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const played = playHazardAndResolve(state, PLAYER_2, cardId, companyId);

    const hostId = played.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === GREAT_SECRETS)!.instanceId;
    const pending = played.pendingResolutions.find(r => r.kind.type === 'great-secrets-choose-item')!;
    const { eligibleInstanceIds, revealedInstanceIds } = pending.kind as {
      eligibleInstanceIds: readonly CardInstanceId[];
      revealedInstanceIds: readonly CardInstanceId[];
    };
    const chosen = eligibleInstanceIds[0];

    const resolved = dispatch(played, { type: 'choose-set-aside-item', player: PLAYER_1, cardInstanceId: chosen });

    // Chosen item is no longer in P1's deck; it is set aside under the host in P2's cardsInPlay.
    expect(resolved.players[RESOURCE_PLAYER].playDeck.some(c => c.instanceId === chosen)).toBe(false);
    const setAsideEntry = resolved.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === chosen);
    expect(setAsideEntry).toBeDefined();
    expect(setAsideEntry!.setAsideHost).toBe(hostId);
    expect(setAsideEntry!.setAsideNoMp).toBe(true);
    const host = resolved.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === hostId)!;
    expect(host.setAside).toEqual([chosen]);

    // The other 9 revealed-or-not cards are all still in P1's deck (nothing lost).
    expect(resolved.players[RESOURCE_PLAYER].playDeck).toHaveLength(9);
    for (const id of revealedInstanceIds) {
      if (id === chosen) continue;
      expect(resolved.players[RESOURCE_PLAYER].playDeck.some(c => c.instanceId === id)).toBe(true);
    }

    // The set-aside item does not contribute marshalling points to anyone.
    expect(resolved.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(0);
    expect(resolved.players[HAZARD_PLAYER].marshallingPoints.item).toBe(0);

    expect(resolved.pendingResolutions.some(r => r.kind.type === 'great-secrets-choose-item')).toBe(false);
    assertEveryInstanceReachable(resolved);
  });

  // ── #4: no eligible item → show, shuffle back, no set-aside ────────────────

  test('with no eligible item among the revealed cards, everything is shuffled back and nothing is set aside', () => {
    // Deck of only ineligible cards: a special item and a character — no items
    // matching the non-special/non-hoard filter.
    const state = buildHazardState({ p1Deck: [PALANTIR_OF_ORTHANC, BILBO] });
    const allTwo = state.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId);
    const cardId = findHandCardId(state, HAZARD_PLAYER, GREAT_SECRETS);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const played = playHazardAndResolve(state, PLAYER_2, cardId, companyId);

    // Revealed to both, but nothing set aside — no pending resolution at all.
    for (const id of allTwo) expect(played.revealedInstances[id]).toBeDefined();
    expect(played.pendingResolutions.some(r => r.kind.type === 'great-secrets-choose-item')).toBe(false);

    // Both cards are still in P1's deck (shuffled, not lost) and nothing is set aside.
    expect(played.players[RESOURCE_PLAYER].playDeck).toHaveLength(2);
    for (const id of allTwo) expect(played.players[RESOURCE_PLAYER].playDeck.some(c => c.instanceId === id)).toBe(true);
    const host = played.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === GREAT_SECRETS)!;
    expect(host.setAside).toBeUndefined();

    assertEveryInstanceReachable(played);
  });

  // ── #5: alternate resource-on-self mode reverses roles ─────────────────────

  test('may be played as a resource on yourself when you have 10+ cards in your own play deck', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_SECRETS], playDeck: DECK_10, siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const top10 = state.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId);
    const cardId = findHandCardId(state, RESOURCE_PLAYER, GREAT_SECRETS);

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(a => (a.action as PlayPermanentEventAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(1);

    const played = playPermanentEventAndResolve(state, PLAYER_1, cardId);

    // Roles reversed: P1 (the caster) is now the deck owner who reveals and chooses.
    for (const id of top10) expect(played.revealedInstances[id]).toBeDefined();
    const pending = played.pendingResolutions.find(r => r.kind.type === 'great-secrets-choose-item');
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_1);
    expect((pending!.kind as { deckOwnerId: string }).deckOwnerId).toBe(PLAYER_1);

    // The host is in P1's own cardsInPlay this time.
    expect(played.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GREAT_SECRETS)).toBe(true);

    assertEveryInstanceReachable(played);
  });

  test('not playable as a resource on yourself with fewer than 10 cards in your play deck', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GREAT_SECRETS], playDeck: [STING, GLAMDRING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, GREAT_SECRETS);
    const plays = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(a => (a.action as PlayPermanentEventAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  // ── #6: the set-aside item is later playable "as though in hand" at Under-deeps ─

  test('a set-aside item (owned by P1, held under P2\'s host) is playable as though in hand at an Under-deeps site', () => {
    const hostId = 'p2-500' as CardInstanceId;
    const itemId = 'p1-501' as CardInstanceId;
    const hostAndChild: CardInPlay[] = [
      { instanceId: hostId, definitionId: GREAT_SECRETS, status: CardStatus.Untapped, setAside: [itemId] },
      { instanceId: itemId, definitionId: DAGGER_OF_WESTERNESSE, status: CardStatus.Untapped, setAsideHost: hostId, setAsideNoMp: true },
    ];

    const base = buildSitePhaseState({ site: UNDER_GATES, characters: [ARAGORN], hand: [] });
    const state: GameState = {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], cardsInPlay: hostAndChild },
      ],
    };

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(a => (a.action as PlayHeroResourceAction).cardInstanceId === itemId);
    expect(plays).toHaveLength(1);
    expect((plays[0].action as PlayHeroResourceAction).fromSetAside).toBe(true);

    const played = dispatch(state, plays[0].action);
    const aragornId = played.players[RESOURCE_PLAYER].companies[0].characters[0];
    expect(played.players[RESOURCE_PLAYER].characters[aragornId].items.some(i => i.instanceId === itemId)).toBe(true);

    // Pulled out of the set-aside slot: gone from P2's cardsInPlay, host's list empty.
    expect(played.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === itemId)).toBe(false);
    const host = played.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === hostId)!;
    expect(host.setAside).toBeUndefined();

    assertEveryInstanceReachable(played);
  });

  test('an item set aside by a different host (Armory) is NOT offered at an Under-deeps site', () => {
    // Regression: the Under-deeps replay offered EVERY owned set-aside item,
    // regardless of which host set it aside. Only items under a Great-Secrets
    // host gain the replay — an Armory (dm-116) cache is playable solely at
    // the site types its own effect lists (Border-hold/Free-hold/Haven),
    // never via the dm-63 Under-deeps window.
    const ARMORY = 'dm-116' as CardDefinitionId;
    const hostId = 'p1-600' as CardInstanceId;
    const itemId = 'p1-601' as CardInstanceId;
    const hostAndChild: CardInPlay[] = [
      { instanceId: hostId, definitionId: ARMORY, status: CardStatus.Untapped, setAside: [itemId] },
      { instanceId: itemId, definitionId: DAGGER_OF_WESTERNESSE, status: CardStatus.Untapped, setAsideHost: hostId, setAsideNoMp: true },
    ];

    const base = buildSitePhaseState({ site: UNDER_GATES, characters: [ARAGORN], hand: [] });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0], cardsInPlay: [...base.players[0].cardsInPlay, ...hostAndChild] },
        base.players[1],
      ],
    };

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(a => (a.action as PlayHeroResourceAction).cardInstanceId === itemId);
    expect(plays).toHaveLength(0);
  });

  test('control: the set-aside item is NOT offered at a non-Under-deeps site', () => {
    const hostId = 'p2-500' as CardInstanceId;
    const itemId = 'p1-501' as CardInstanceId;
    const hostAndChild: CardInPlay[] = [
      { instanceId: hostId, definitionId: GREAT_SECRETS, status: CardStatus.Untapped, setAside: [itemId] },
      { instanceId: itemId, definitionId: DAGGER_OF_WESTERNESSE, status: CardStatus.Untapped, setAsideHost: hostId, setAsideNoMp: true },
    ];

    const base = buildSitePhaseState({ site: RIVENDELL, characters: [ARAGORN], hand: [] });
    const state: GameState = {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], cardsInPlay: hostAndChild },
      ],
    };

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(a => (a.action as PlayHeroResourceAction).cardInstanceId === itemId);
    expect(plays).toHaveLength(0);
  });
});
