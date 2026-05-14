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
 * | # | Effect Type  | Status          | Notes                                          |
 * |---|--------------|-----------------|------------------------------------------------|
 * | 1 | play-window  | OK              | restricts card to site phase                   |
 * | 2 | play-target  | OK              | scout filter + tap cost                        |
 * | 3 | (site-type)  | NOT IMPLEMENTED | shadow-hold/dark-hold restriction unenforceable for short events |
 * | 4 | (deck-search)| NOT IMPLEMENTED | reveal-from-deck mechanic not in engine        |
 * | 5 | (dynamic-atk)| NOT IMPLEMENTED | prowess = 3 + revealed count, uncancelable     |
 * | 6 | (cond-discard)| NOT IMPLEMENTED| discard item if scout wounded                  |
 * | 7 | (reshuffle)  | NOT IMPLEMENTED | reshuffle revealed cards into deck             |
 *
 * Playable: PARTIALLY — play-window and scout restriction work; the core
 * mechanic (deck search + generated combat) is not implemented.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FRODO,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
  buildSitePhaseState, buildTestState, resetMint,
  handCardId,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const LUCKY_SEARCH = 'tw-269' as CardDefinitionId;

describe('Lucky Search (tw-269)', () => {
  beforeEach(() => resetMint());

  // ── Play restriction: scout required ──────────────────────────────────────

  test('play-short-event offered for a scout in site phase', () => {
    // Aragorn has the scout skill — Lucky Search should appear as a viable
    // play-short-event action (one action for Aragorn as the tap target).
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

  // ── Unimplemented rules (engine work required) ────────────────────────────

  test.todo('only playable at a Shadow-hold or Dark-hold (site-type restriction for short events not implemented)');

  test.todo('reveal cards one at a time from play deck until non-special non-duplicate-unique item found or deck end');

  test.todo('scout takes control of revealed item when found');

  test.todo('scout faces single-strike attack with prowess 3 + number of cards revealed');

  test.todo('attack/strike generated by Lucky Search cannot be canceled');

  test.todo('item is discarded if the scout is wounded by the Lucky Search attack');

  test.todo('all revealed cards except the item are reshuffled into the play deck');
});
