/**
 * @module tw-269.test
 *
 * Card test: Lucky Search (tw-269)
 * Type: hero-resource-event (short)
 * Text: "Scout only. During the site phase, tap a scout at a tapped or untapped
 *   Shadow-hold [{S}] or Dark-hold [{D}]. Turn over cards from your play deck
 *   one at a time until: you reveal a non-special item (it cannot be a unique
 *   item already in play) or reach the end (does not exhaust the play deck).
 *   If you reveal such an item, the scout takes control of it. In any case,
 *   the scout faces a single strike attack with prowess equal to 3 plus the
 *   number of cards revealed. This attack/strike cannot be canceled. Discard
 *   the item if the scout is wounded. Reshuffle all revealed cards except the
 *   item back into the play deck."
 *
 * Effects:
 * | # | Effect Type        | Status | Notes                                              |
 * |---|--------------------|--------|----------------------------------------------------|
 * | 1 | play-window        | OK     | restricts card to site phase                       |
 * | 2 | play-target        | OK     | scout filter + tap cost + shadow/dark-hold filter  |
 * | 3 | site-type          | OK     | shadow-hold/dark-hold restriction via filter       |
 * | 4 | deck-search        | OK     | reveal cards until non-special item or deck end    |
 * | 5 | dynamic-atk        | OK     | prowess = 3 + revealed count, uncancelable         |
 * | 6 | item-acquisition   | OK     | scout takes control of item if not wounded         |
 * | 7 | cond-discard       | OK     | item discarded if scout wounded                    |
 * | 8 | reshuffle          | OK     | non-item revealed cards reshuffled back to deck    |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FRODO,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
  buildSitePhaseState, buildTestState, resetMint,
  handCardId,
  RESOURCE_PLAYER,
  findCharInstanceId,
  viableActions,
  runCardTriggeredAttackCombat,
  makeSitePhase,
} from '../test-helpers.js';
import { computeLegalActions, Phase, reduce } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import { DAGGER_OF_WESTERNESSE, GLAMDRING, SUN } from '../../card-ids.js';

const LUCKY_SEARCH = 'tw-269' as CardDefinitionId;

describe('Lucky Search (tw-269)', () => {
  beforeEach(() => resetMint());

  // ── Play restriction: scout required ──────────────────────────────────────

  test('play-short-event offered for a scout in site phase at shadow-hold', () => {
    // Aragorn has the scout skill and MORIA is a shadow-hold.
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: MORIA,
      hand: [LUCKY_SEARCH],
    });

    const luckySearchId = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1);
    const shortEvents = actions.filter(
      a => a.viable && a.action.type === 'play-short-event'
        && (a.action).cardInstanceId === luckySearchId,
    );

    expect(shortEvents).toHaveLength(1);
  });

  test('not offered when company has no scout', () => {
    // Legolas is a warrior/diplomat only — Lucky Search should not be offered.
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: MORIA,
      hand: [LUCKY_SEARCH],
    });

    const luckySearchId = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1);
    const shortEvents = actions.filter(
      a => a.viable && a.action.type === 'play-short-event'
        && (a.action).cardInstanceId === luckySearchId,
    );

    expect(shortEvents).toHaveLength(0);
  });

  test('one action offered per eligible scout when multiple scouts in company', () => {
    // Aragorn and Frodo both have the scout skill — two play-short-event
    // actions should be offered (one per scout tap target).
    const state = buildSitePhaseState({
      characters: [ARAGORN, FRODO],
      site: MORIA,
      hand: [LUCKY_SEARCH],
    });

    const luckySearchId = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1);
    const shortEvents = actions.filter(
      a => a.viable && a.action.type === 'play-short-event'
        && (a.action).cardInstanceId === luckySearchId,
    );

    expect(shortEvents).toHaveLength(2);
  });

  // ── Play-window: site phase only ──────────────────────────────────────────

  test('not playable during organization phase', () => {
    // Lucky Search declares play-window: site, so it must not appear as
    // viable during the organization phase even when a scout is in hand.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LUCKY_SEARCH], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const luckySearchId = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1);
    const shortEvents = actions.filter(
      a => a.viable && a.action.type === 'play-short-event'
        && (a.action).cardInstanceId === luckySearchId,
    );

    expect(shortEvents).toHaveLength(0);
  });

  // ── Site-type restriction ─────────────────────────────────────────────────

  test('not offered when company is at a haven (not shadow-hold or dark-hold)', () => {
    // RIVENDELL is a Haven — Lucky Search requires shadow-hold or dark-hold.
    const state = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LUCKY_SEARCH], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const luckySearchId = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1);
    const shortEvents = actions.filter(
      a => a.viable && a.action.type === 'play-short-event'
        && (a.action).cardInstanceId === luckySearchId,
    );

    expect(shortEvents).toHaveLength(0);
  });

  // ── Deck search + attack initiation ──────────────────────────────────────

  test('playing Lucky Search initiates a combat with prowess 3 + cards revealed', () => {
    // Deck: [SUN, SUN, DAGGER_OF_WESTERNESSE, ...]
    // Reveal 3 cards (SUN, SUN, Dagger). Attack prowess = 3 + 3 = 6.
    const state = {
      ...buildTestState({
        phase: Phase.Site,
        activePlayer: PLAYER_1,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: MORIA, characters: [ARAGORN] }],
            hand: [LUCKY_SEARCH],
            siteDeck: [MINAS_TIRITH],
            playDeck: [SUN, SUN, DAGGER_OF_WESTERNESSE],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
        ],
      }),
      phaseState: makeSitePhase(),
    };

    const luckySearchId = handCardId(state, RESOURCE_PLAYER);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const playActions = viableActions(state, PLAYER_1, 'play-short-event').filter(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === luckySearchId,
    );
    expect(playActions).toHaveLength(1);

    const result = reduce(state, playActions[0].action);
    expect(result.error).toBeUndefined();

    // Combat should be active after playing
    expect(result.state.combat).not.toBeNull();
    expect(result.state.combat?.attackSource.type).toBe('lucky-search-attack');
    // 3 cards revealed: SUN, SUN, DAGGER → prowess = 3 + 3 = 6
    expect(result.state.combat?.strikeProwess).toBe(6);
    expect(result.state.combat?.strikesTotal).toBe(1);
    expect(result.state.combat?.uncancelable).toBe(true);
    expect(result.state.combat?.companyId).toBe(
      state.players[RESOURCE_PLAYER].companies[0].id,
    );
    // The scout is named as the scout in the attack source
    const src = result.state.combat?.attackSource as { type: 'lucky-search-attack'; scoutInstanceId: unknown };
    expect(src.scoutInstanceId).toBe(aragornId);
  });

  test('attack/strike generated by Lucky Search cannot be canceled', () => {
    const state = {
      ...buildTestState({
        phase: Phase.Site,
        activePlayer: PLAYER_1,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: MORIA, characters: [ARAGORN] }],
            hand: [LUCKY_SEARCH],
            siteDeck: [MINAS_TIRITH],
            playDeck: [DAGGER_OF_WESTERNESSE],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
        ],
      }),
      phaseState: makeSitePhase(),
    };

    const luckySearchId = handCardId(state, RESOURCE_PLAYER);
    const playAction = viableActions(state, PLAYER_1, 'play-short-event').find(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === luckySearchId,
    )!;
    const afterPlay = reduce(state, playAction.action);
    expect(afterPlay.error).toBeUndefined();
    expect(afterPlay.state.combat?.uncancelable).toBe(true);

    // Cancel-attack must not appear as a viable action
    const cancelActions = computeLegalActions(afterPlay.state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'cancel-attack',
    );
    expect(cancelActions).toHaveLength(0);
  });

  test('attack prowess = 3 when deck is empty (no cards revealed)', () => {
    // Empty deck: 0 cards revealed → prowess = 3 + 0 = 3.
    const state = {
      ...buildTestState({
        phase: Phase.Site,
        activePlayer: PLAYER_1,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: MORIA, characters: [ARAGORN] }],
            hand: [LUCKY_SEARCH],
            siteDeck: [MINAS_TIRITH],
            playDeck: [],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
        ],
      }),
      phaseState: makeSitePhase(),
    };

    const luckySearchId = handCardId(state, RESOURCE_PLAYER);
    const playAction = viableActions(state, PLAYER_1, 'play-short-event').find(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === luckySearchId,
    )!;
    const afterPlay = reduce(state, playAction.action);
    expect(afterPlay.error).toBeUndefined();
    expect(afterPlay.state.combat?.strikeProwess).toBe(3);
    const src = afterPlay.state.combat?.attackSource as { foundItemInstanceId: unknown };
    expect(src.foundItemInstanceId).toBeNull();
  });

  test('scout takes control of found item when not wounded', () => {
    // Deck: [DAGGER_OF_WESTERNESSE] — immediately found on first reveal.
    // Aragorn succeeds against the strike (roll high enough to avoid wound).
    const state = {
      ...buildTestState({
        phase: Phase.Site,
        activePlayer: PLAYER_1,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: MORIA, characters: [ARAGORN] }],
            hand: [LUCKY_SEARCH],
            siteDeck: [MINAS_TIRITH],
            playDeck: [DAGGER_OF_WESTERNESSE],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
        ],
      }),
      phaseState: makeSitePhase(),
    };

    const luckySearchId = handCardId(state, RESOURCE_PLAYER);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const playAction = viableActions(state, PLAYER_1, 'play-short-event').find(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === luckySearchId,
    )!;
    let s = reduce(state, playAction.action).state;
    expect(s.combat).not.toBeNull();

    // Run the attack: Aragorn succeeds (roll = 12, well above prowess 4)
    s = runCardTriggeredAttackCombat(s, [{ characterDefId: ARAGORN, roll: 12 }]);
    expect(s.combat).toBeNull();

    // Aragorn should now have the Dagger attached
    const aragorn = s.players[RESOURCE_PLAYER].characters[aragornId as string];
    expect(aragorn.items).toHaveLength(1);
    expect(aragorn.items[0].definitionId).toBe(DAGGER_OF_WESTERNESSE);

    // Deck should be empty (item was the only card, now attached)
    expect(s.players[RESOURCE_PLAYER].playDeck).toHaveLength(0);
  });

  test('item is discarded if the scout is wounded by the Lucky Search attack', () => {
    // Use Frodo (prowess 1) so he can be wounded by the attack.
    // Deck: [DAGGER_OF_WESTERNESSE]. One card revealed → prowess = 3 + 1 = 4.
    // Frodo rolls 2: total = 2 + 1 = 3 < 4 → wounded. Body roll 2 ≤ 9 → survives.
    const state = {
      ...buildTestState({
        phase: Phase.Site,
        activePlayer: PLAYER_1,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: MORIA, characters: [FRODO] }],
            hand: [LUCKY_SEARCH],
            siteDeck: [MINAS_TIRITH],
            playDeck: [DAGGER_OF_WESTERNESSE],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
        ],
      }),
      phaseState: makeSitePhase(),
    };

    const luckySearchId = handCardId(state, RESOURCE_PLAYER);
    const playAction = viableActions(state, PLAYER_1, 'play-short-event').find(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === luckySearchId,
    )!;
    let s = reduce(state, playAction.action).state;
    expect(s.combat).not.toBeNull();
    // Frodo total = 2 + 1 = 3 < 4 → wounded; body roll 2 ≤ 9 → survives
    s = runCardTriggeredAttackCombat(s, [{ characterDefId: FRODO, roll: 2, bodyRoll: 2 }]);
    expect(s.combat).toBeNull();

    // Frodo should have NO items (Dagger discarded due to wound)
    const frodoId = findCharInstanceId(s, RESOURCE_PLAYER, FRODO);
    const frodo = s.players[RESOURCE_PLAYER].characters[frodoId as string];
    expect(frodo.items).toHaveLength(0);

    // Dagger should be in discard pile
    const daggerInDiscard = s.players[RESOURCE_PLAYER].discardPile.some(
      c => c.definitionId === DAGGER_OF_WESTERNESSE,
    );
    expect(daggerInDiscard).toBe(true);
  });

  test('all revealed non-item cards are reshuffled into the play deck', () => {
    // Deck: [SUN, SUN, DAGGER_OF_WESTERNESSE].
    // SUN (long-event, not an item) × 2 are revealed before the Dagger.
    // After combat (success), the 2 SUN cards go back to the deck.
    const state = {
      ...buildTestState({
        phase: Phase.Site,
        activePlayer: PLAYER_1,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: MORIA, characters: [ARAGORN] }],
            hand: [LUCKY_SEARCH],
            siteDeck: [MINAS_TIRITH],
            playDeck: [SUN, SUN, DAGGER_OF_WESTERNESSE],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
        ],
      }),
      phaseState: makeSitePhase(),
    };

    const luckySearchId = handCardId(state, RESOURCE_PLAYER);
    const playAction = viableActions(state, PLAYER_1, 'play-short-event').find(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === luckySearchId,
    )!;
    let s = reduce(state, playAction.action).state;
    expect(s.combat).not.toBeNull();
    // prowess = 3 + 3 = 6 (SUN, SUN, Dagger revealed)
    expect(s.combat?.strikeProwess).toBe(6);

    // Aragorn succeeds (high roll)
    s = runCardTriggeredAttackCombat(s, [{ characterDefId: ARAGORN, roll: 12 }]);
    expect(s.combat).toBeNull();

    // The 2 SUN cards should be reshuffled into the deck; item goes to Aragorn
    const deck = s.players[RESOURCE_PLAYER].playDeck;
    expect(deck).toHaveLength(2);
    expect(deck.every(c => c.definitionId === SUN)).toBe(true);
  });

  test('unique item already in play is skipped during deck search', () => {
    // GLAMDRING is unique. If it's already equipped to Aragorn, the deck
    // search should skip it and continue until it finds another item or ends.
    // Deck: [GLAMDRING, DAGGER_OF_WESTERNESSE]. Glamdring is already on Aragorn.
    // Expected: skip Glamdring, find Dagger on 2nd reveal → prowess = 3 + 2 = 5.
    const state = {
      ...buildTestState({
        phase: Phase.Site,
        activePlayer: PLAYER_1,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }],
            hand: [LUCKY_SEARCH],
            siteDeck: [MINAS_TIRITH],
            playDeck: [GLAMDRING, DAGGER_OF_WESTERNESSE],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
        ],
      }),
      phaseState: makeSitePhase(),
    };

    const luckySearchId = handCardId(state, RESOURCE_PLAYER);
    const playAction = viableActions(state, PLAYER_1, 'play-short-event').find(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === luckySearchId,
    )!;
    const afterPlay = reduce(state, playAction.action);
    expect(afterPlay.error).toBeUndefined();

    // Glamdring skipped (already in play), Dagger found on 2nd reveal → prowess = 3 + 2 = 5
    expect(afterPlay.state.combat?.strikeProwess).toBe(5);
    const src = afterPlay.state.combat?.attackSource as { foundItemInstanceId: unknown };
    expect(src.foundItemInstanceId).not.toBeNull();
  });
});
