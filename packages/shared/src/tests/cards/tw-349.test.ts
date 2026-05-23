/**
 * @module tw-349.test
 *
 * Card test: Thorough Search (tw-349)
 * Type: hero-resource-event (short, wizard alignment)
 * Effects:
 *   1. play-window: phase "site" — only playable during the site phase
 *   2. play-target: character with filter (scout skill) + cost (tap) — targets
 *      an untapped scout; the scout is tapped when played
 *   3. on-event: self-enters-play → unlock-thorough-search — sets
 *      SitePhaseState.thoroughSearchAvailable, allowing one additional minor,
 *      major, or gold ring item to be played without tapping the site.
 *
 * Card text: "Scout only. Playable during the site phase on an untapped scout.
 * Tap the scout. Another character in his company may play a minor, major, or
 * gold ring item normally playable at the site. This does not tap the site,
 * and Thorough Search can be played at a site that is already tapped."
 *
 * Engine Support:
 * | # | Effect Type               | Status      | Notes                                          |
 * |---|---------------------------|-------------|------------------------------------------------|
 * | 1 | play-window site          | IMPLEMENTED | heroResourceShortEventActions + site filter    |
 * | 2 | play-target scout + tap   | IMPLEMENTED | DSL filter + cost via condition-matcher        |
 * | 3 | unlock-thorough-search    | IMPLEMENTED | applyShortEventOnEntersPlay, reducer-site      |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  ARAGORN, LEGOLAS, GIMLI, PLAYER_1, PLAYER_2, LORIEN, MINAS_TIRITH, MORIA,
  ISENGARD,
  resetMint, buildSitePhaseState, buildTestState,
  handCardId, findCharInstanceId, dispatch, viableActions,
  CardStatus, Phase,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, SitePhaseState, PlayShortEventAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const THOROUGH_SEARCH = 'tw-349' as CardDefinitionId;

// Isengard (tw-404): playable items are minor, major, gold-ring — good test site
// ISENGARD is already exported from test-helpers (tw-404)

// Minor item with no site restriction
const DAGGER_OF_WESTERNESSE = 'tw-206' as CardDefinitionId;

// Major item with no site restriction
const GLAMDRING = 'tw-244' as CardDefinitionId;

// Gold ring item with no site restriction
const PRECIOUS_GOLD_RING = 'tw-306' as CardDefinitionId;

// Aragorn (tw-120) is a scout — used as the target of Thorough Search
// ARAGORN is already exported from test-helpers (tw-120)

// Legolas (tw-168) is warrior/diplomat — NOT a scout
// LEGOLAS is already exported from test-helpers (tw-168)

describe('Thorough Search (tw-349)', () => {
  beforeEach(() => resetMint());

  // ─── play-window: only playable during site phase ────────────────────────────

  test('not offered during organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: ISENGARD, characters: [ARAGORN] }], hand: [THOROUGH_SEARCH], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  test('offered during site phase at play-resources step', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [ARAGORN],
      hand: [THOROUGH_SEARCH],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── play-target: scout only ─────────────────────────────────────────────────

  test('only offered when a scout is in the company', () => {
    // Legolas is not a scout — no valid target
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [LEGOLAS],
      hand: [THOROUGH_SEARCH],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  test('targets the untapped scout character via targetScoutInstanceId', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [ARAGORN],
      hand: [THOROUGH_SEARCH],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
    // play-target with cost.tap uses targetScoutInstanceId for the tapped character
    expect(playActions.every(a => a.targetScoutInstanceId === aragornId)).toBe(true);
  });

  test('not offered when the scout is tapped', () => {
    // Tap Aragorn before the play-resources step
    const base = buildSitePhaseState({
      site: ISENGARD,
      characters: [{ defId: ARAGORN, status: CardStatus.Tapped }],
      hand: [THOROUGH_SEARCH],
    });

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  // ─── can be played at a tapped site ──────────────────────────────────────────

  test('offered at a tapped site', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [ARAGORN],
      siteStatus: CardStatus.Tapped,
      hand: [THOROUGH_SEARCH],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── core effect: playing the event sets thoroughSearchAvailable ──────────────

  test('playing the event sets thoroughSearchAvailable in phaseState', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [ARAGORN],
      hand: [THOROUGH_SEARCH],
    });
    const eventInstance = handCardId(state, RESOURCE_PLAYER);

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === eventInstance);
    expect(playActions).toHaveLength(1);

    const next = dispatch(state, playActions[0]);
    expect((next.phaseState as SitePhaseState).thoroughSearchAvailable).toBe(true);
  });

  // ─── thoroughSearchBonus: allows minor item at tapped site ───────────────────

  test('minor item playable at tapped site when thoroughSearchAvailable', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [ARAGORN],
      siteStatus: CardStatus.Tapped,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const searchState = {
      ...state,
      phaseState: { ...(state.phaseState), thoroughSearchAvailable: true },
    };

    const playActions = viableActions(searchState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major item playable at tapped site when thoroughSearchAvailable', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [ARAGORN],
      siteStatus: CardStatus.Tapped,
      hand: [GLAMDRING],
    });
    const searchState = {
      ...state,
      phaseState: { ...(state.phaseState), thoroughSearchAvailable: true },
    };

    const playActions = viableActions(searchState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold ring item playable at tapped site when thoroughSearchAvailable', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [ARAGORN],
      siteStatus: CardStatus.Tapped,
      hand: [PRECIOUS_GOLD_RING],
    });
    const searchState = {
      ...state,
      phaseState: { ...(state.phaseState), thoroughSearchAvailable: true },
    };

    const playActions = viableActions(searchState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── item via Thorough Search does NOT tap the site ──────────────────────────

  test('playing item via thoroughSearch does not tap the site', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const searchState = {
      ...state,
      phaseState: { ...(state.phaseState), thoroughSearchAvailable: true },
    };

    const playActions = viableActions(searchState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(searchState, playActions[0].action);
    const company = next.players[0].companies[0];
    expect(company.currentSite?.status).toBe(CardStatus.Untapped);
  });

  // ─── thoroughSearchAvailable is cleared after item is played ─────────────────

  test('thoroughSearchAvailable is cleared after playing a minor item', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [ARAGORN],
      siteStatus: CardStatus.Tapped,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const searchState = {
      ...state,
      phaseState: { ...(state.phaseState), thoroughSearchAvailable: true },
    };

    const playActions = viableActions(searchState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(searchState, playActions[0].action);
    expect((next.phaseState as SitePhaseState).thoroughSearchAvailable).toBe(false);
  });

  test('thoroughSearchAvailable is cleared after playing a major item', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [ARAGORN],
      siteStatus: CardStatus.Tapped,
      hand: [GLAMDRING],
    });
    const searchState = {
      ...state,
      phaseState: { ...(state.phaseState), thoroughSearchAvailable: true },
    };

    const playActions = viableActions(searchState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(searchState, playActions[0].action);
    expect((next.phaseState as SitePhaseState).thoroughSearchAvailable).toBe(false);
  });

  // ─── item via Thorough Search does NOT set resourcePlayed ────────────────────

  test('playing item via thoroughSearch does not set resourcePlayed', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const searchState = {
      ...state,
      phaseState: { ...(state.phaseState), thoroughSearchAvailable: true },
    };

    const playActions = viableActions(searchState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(searchState, playActions[0].action);
    // resourcePlayed should remain false (Thorough Search plays do not count)
    expect((next.phaseState as SitePhaseState).resourcePlayed).toBe(false);
  });

  // ─── without thoroughSearchAvailable, item not playable at tapped site ───────

  test('minor item not playable at tapped site without thoroughSearchAvailable', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [ARAGORN],
      siteStatus: CardStatus.Tapped,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  // ─── full flow: play event, then play item ────────────────────────────────────

  test('full flow: event played at tapped site unlocks minor item play without tapping site', () => {
    // Aragorn (scout) taps to play Thorough Search; Gimli (non-scout) plays the item.
    // Two characters are needed since the scout gets tapped by the event cost.
    const state = buildSitePhaseState({
      site: ISENGARD,
      characters: [ARAGORN, GIMLI],
      siteStatus: CardStatus.Tapped,
      hand: [THOROUGH_SEARCH, DAGGER_OF_WESTERNESSE],
    });

    // Item is not playable without the event (site is tapped)
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);

    // Play Thorough Search on Aragorn
    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    const eventActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === eventInstance);
    expect(eventActions).toHaveLength(1);
    const afterEvent = dispatch(state, eventActions[0]);

    // thoroughSearchAvailable is now set
    expect((afterEvent.phaseState as SitePhaseState).thoroughSearchAvailable).toBe(true);

    // Item is now playable (Gimli is still untapped and can bear it)
    const itemActions = viableActions(afterEvent, PLAYER_1, 'play-hero-resource');
    expect(itemActions.length).toBeGreaterThanOrEqual(1);

    // Play the item — site should remain tapped (not double-tapped), flag cleared
    const afterItem = dispatch(afterEvent, itemActions[0].action);
    expect((afterItem.phaseState as SitePhaseState).thoroughSearchAvailable).toBe(false);
    const company = afterItem.players[0].companies[0];
    expect(company.currentSite?.status).toBe(CardStatus.Tapped);

    // Dagger of Westernesse is attached to Gimli (the untapped character)
    const gimliChar = Object.values(afterItem.players[0].characters)
      .find(ch => ch.definitionId === GIMLI);
    expect(gimliChar?.items.some(i => i.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
  });
});
