/**
 * @module tw-238.test
 *
 * Card test: Far-sight (tw-238)
 * Type: hero-resource-event (short, alignment: wizard)
 * Effects: play-window, play-target (character, cost tap), play-condition
 * (site-has-resource information), play-flag×2 (untapped-site-required,
 * tap-site-on-play), move (fetch item from deck to hand, revealToOpponent),
 * on-event (enqueue-corruption-check)
 *
 * "Sage only. Playable during the site phase on an untapped sage at an
 *  untapped site where Information is playable. Tap the sage and the site.
 *  Search through your play deck and choose an item that you must reveal to
 *  your opponent. This item is placed in your hand and the play deck is
 *  reshuffled. The sage makes a corruption check."
 *
 * | # | Rule fragment                                          | Status      |
 * |---|---------------------------------------------------------|-------------|
 * | 1 | Playable during the site phase only                    | IMPLEMENTED |
 * | 2 | Sage only — untapped sage (tap cost)                    | IMPLEMENTED |
 * | 3 | Only at a site where Information is playable            | IMPLEMENTED |
 * | 4 | Site must be untapped                                   | IMPLEMENTED |
 * | 5 | Sage is tapped on play                                  | IMPLEMENTED |
 * | 6 | Site is tapped on play                                  | IMPLEMENTED |
 * | 7 | Search play deck, choose an item, reveal to opponent    | IMPLEMENTED |
 * | 8 | Item placed in hand, play deck reshuffled               | IMPLEMENTED |
 * | 9 | Sage makes a corruption check                           | IMPLEMENTED |
 *
 * Fixture alignment: hero (wizard) — uses TW hero characters/sites/items.
 *
 * Character fixtures:
 *   - ELROND (tw-145): warrior+sage+diplomat — sage
 *   - ARAGORN (tw-...): warrior/ranger/scout — non-sage companion
 *
 * Site fixtures:
 *   - DIMRILL_DALE (tw-385): ruins-and-lairs, information playable
 *   - MORIA        (tw-413): shadow-hold, information NOT listed
 *
 * Item fixtures:
 *   - GLAMDRING (tw-244), DAGGER_OF_WESTERNESSE (tw-206): hero-resource-item
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ELROND, ARAGORN, LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  buildTestState, resetMint,
  viableActions, findCharInstanceId, findHandCardId,
  dispatch,
  RESOURCE_PLAYER,
  expectCharStatus, expectInDiscardPile,
  CardStatus,
} from '../test-helpers.js';
import type {
  CardDefinitionId,
  CardInstanceId,
  PlayShortEventAction,
  FetchFromPileAction,
} from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { SitePhaseState } from '../../index.js';

const FAR_SIGHT = 'tw-238' as CardDefinitionId;

// Ruins-and-lairs site with Information playable.
const DIMRILL_DALE = 'tw-385' as CardDefinitionId;

/** Build a site-phase state (play-resources step) with the given setup. */
function buildFarSight(opts: {
  site?: CardDefinitionId;
  characters?: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
  siteStatus?: CardStatus;
} = {}) {
  const site = opts.site ?? DIMRILL_DALE;
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site, characters: opts.characters ?? [ELROND] }],
        hand: [FAR_SIGHT],
        siteDeck: [MORIA],
        playDeck: opts.playDeck,
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });

  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: 'play-resources',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: true,
    resourcePlayed: false,
    minorItemAvailable: false,
    hoardBountyAvailable: false,
    thoroughSearchAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
  };

  let state = { ...base, phaseState: sitePhaseState };
  if (opts.siteStatus) {
    const company = state.players[0].companies[0];
    state = {
      ...state,
      players: [
        {
          ...state.players[0],
          companies: [{ ...company, currentSite: { ...company.currentSite!, status: opts.siteStatus } }],
        },
        state.players[1],
      ] as typeof state.players,
    };
  }
  return state;
}

describe('Far-sight (tw-238)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1-3: playability gating ─────────────────────────────────────────

  test('offered on an untapped sage at an untapped site where Information is playable', () => {
    const state = buildFarSight();
    const plays = viableActions(state, PLAYER_1, 'play-short-event') as Array<{ action: PlayShortEventAction }>;
    expect(plays.length).toBeGreaterThanOrEqual(1);
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    expect(plays[0].action.targetScoutInstanceId).toBe(elrondId);
  });

  test('not offered when no sage in company', () => {
    const state = buildFarSight({ characters: [ARAGORN] });
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(0);
  });

  test('not offered when sage is already tapped', () => {
    const state = buildFarSight();
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const tapped = {
      ...state,
      players: [
        {
          ...state.players[0],
          characters: {
            ...state.players[0].characters,
            [elrondId as string]: { ...state.players[0].characters[elrondId], status: CardStatus.Tapped },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
    const plays = viableActions(tapped, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(0);
  });

  test('not offered when site does not have Information as a playable resource', () => {
    const state = buildFarSight({ site: MORIA });
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(0);
  });

  // ── Rule 4: site must be untapped ─────────────────────────────────────────

  test('not offered when the site is already tapped', () => {
    const state = buildFarSight({ siteStatus: CardStatus.Tapped });
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(0);
    const notPlayable = computeLegalActions(state, PLAYER_1)
      .filter(ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId
          === findHandCardId(state, RESOURCE_PLAYER, FAR_SIGHT));
    expect(notPlayable).toHaveLength(1);
  });

  // ── Rules 5-6: sage and site tapped on play ───────────────────────────────

  test('playing the card taps the sage and the site', () => {
    const state = buildFarSight({ playDeck: [GLAMDRING] });
    const plays = viableActions(state, PLAYER_1, 'play-short-event') as Array<{ action: PlayShortEventAction }>;
    const afterPlay = dispatch(state, plays[0].action);

    expectCharStatus(afterPlay, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);
    const company = afterPlay.players[RESOURCE_PLAYER].companies[0];
    expect(company.currentSite?.status).toBe(CardStatus.Tapped);
  });

  // ── Rules 7-8: fetch an item from the play deck, reveal it, reshuffle ─────

  test('fetching offers only items from the play deck', () => {
    const state = buildFarSight({ playDeck: [GLAMDRING, DAGGER_OF_WESTERNESSE] });
    const plays = viableActions(state, PLAYER_1, 'play-short-event') as Array<{ action: PlayShortEventAction }>;
    const afterPlay = dispatch(state, plays[0].action);

    expect(afterPlay.pendingEffects).toHaveLength(1);
    expect(afterPlay.pendingEffects[0].type).toBe('card-effect');
    expect(afterPlay.pendingEffects[0].effect.type).toBe('fetch-to-deck');

    const fetches = viableActions(afterPlay, PLAYER_1, 'fetch-from-pile');
    expect(fetches.length).toBe(2);
    const defs = fetches.map(a => {
      const inst = (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId;
      return afterPlay.players[RESOURCE_PLAYER].playDeck.find(c => c.instanceId === inst)?.definitionId;
    });
    expect(defs).toContain(GLAMDRING);
    expect(defs).toContain(DAGGER_OF_WESTERNESSE);
  });

  test('fetching takes the chosen item to hand, reveals it to the opponent, and reshuffles the deck', () => {
    const state = buildFarSight({ playDeck: [GLAMDRING, DAGGER_OF_WESTERNESSE] });
    const glamdringId = state.players[RESOURCE_PLAYER].playDeck.find(c => c.definitionId === GLAMDRING)!.instanceId;
    const plays = viableActions(state, PLAYER_1, 'play-short-event') as Array<{ action: PlayShortEventAction }>;
    let s = dispatch(state, plays[0].action);

    const fetch = viableActions(s, PLAYER_1, 'fetch-from-pile').find(a =>
      (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId === glamdringId,
    );
    expect(fetch).toBeDefined();
    s = dispatch(s, fetch!.action as FetchFromPileAction);

    const p0 = s.players[RESOURCE_PLAYER];
    expect(p0.hand.some(c => c.instanceId === glamdringId)).toBe(true);
    expect(s.revealedInstances[glamdringId]).toBe(GLAMDRING);
    expect(p0.playDeck.map(c => c.definitionId)).toEqual([DAGGER_OF_WESTERNESSE]);
    expectInDiscardPile(s, RESOURCE_PLAYER, FAR_SIGHT);
  });

  // ── Rule 9: sage makes a corruption check ─────────────────────────────────

  test('resolving the fetch enqueues a corruption check on the sage', () => {
    const state = buildFarSight({ playDeck: [GLAMDRING] });
    const glamdringId = state.players[RESOURCE_PLAYER].playDeck.find(c => c.definitionId === GLAMDRING)!.instanceId;
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const plays = viableActions(state, PLAYER_1, 'play-short-event') as Array<{ action: PlayShortEventAction }>;
    let s = dispatch(state, plays[0].action);

    // No corruption check yet — deferred until the interactive fetch resolves.
    expect(s.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);

    const fetch = viableActions(s, PLAYER_1, 'fetch-from-pile').find(a =>
      (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId === glamdringId,
    );
    s = dispatch(s, fetch!.action as FetchFromPileAction);

    const corruptionChecks = s.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check'
        && (r.kind as { characterId: CardInstanceId }).characterId === elrondId,
    );
    expect(corruptionChecks).toHaveLength(1);
  });

  test('the player may decline the fetch (pass), still leaving the deck intact and the sage checked', () => {
    const state = buildFarSight({ playDeck: [GLAMDRING] });
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const plays = viableActions(state, PLAYER_1, 'play-short-event') as Array<{ action: PlayShortEventAction }>;
    let s = dispatch(state, plays[0].action);

    s = dispatch(s, { type: 'pass', player: PLAYER_1 });

    expect(s.players[RESOURCE_PLAYER].playDeck.map(c => c.definitionId)).toEqual([GLAMDRING]);
    const corruptionChecks = s.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check'
        && (r.kind as { characterId: CardInstanceId }).characterId === elrondId,
    );
    expect(corruptionChecks).toHaveLength(1);
    expectInDiscardPile(s, RESOURCE_PLAYER, FAR_SIGHT);
  });
});
