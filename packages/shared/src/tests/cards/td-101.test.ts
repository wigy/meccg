/**
 * @module td-101.test
 *
 * Card test: Bounty of the Hoard (td-101)
 * Type: hero-resource-event (short, wizard alignment)
 * Effects:
 *   1. play-window: phase "site" — only playable during the site phase
 *   2. play-condition: requires "active-company", condition
 *      `{ "site.keywords": { "$includes": "hoard" } }` — rule 5.1.2 bars
 *      playing a short-event with no potential effect on the board state;
 *      this card's only effect can never matter at a non-hoard site.
 *   3. on-event: self-enters-play → set-site-phase-flag(hoardBountyAvailable) — sets
 *      SitePhaseState.hoardBountyAvailable, allowing one additional minor or
 *      major item to be played at the tapped hoard site.
 *
 * Card text: "Playable during the site phase. One minor or major item may be
 * played at a tapped site that contains a hoard."
 *
 * Engine Support:
 * | # | Effect Type           | Status      | Notes                                      |
 * |---|-----------------------|-------------|--------------------------------------------|
 * | 1 | play-window site      | IMPLEMENTED | heroResourceShortEventActions + org filter |
 * | 2 | play-condition        | IMPLEMENTED | playResourceShortEventActions, buildActiveCompanyContext |
 * | 3 | set-site-phase-flag   | IMPLEMENTED | applyShortEventOnEntersPlay, reducer-site  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  ARAGORN, PLAYER_1, PLAYER_2, LORIEN, MINAS_TIRITH,
  resetMint, buildSitePhaseState, buildTestState,
  handCardId, dispatch, viableActions,
  CardStatus, Phase,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, SitePhaseState, PlayShortEventAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const BOUNTY_OF_THE_HOARD = 'td-101' as CardDefinitionId;

// Hoard site (The Lonely Mountain, tw-428): playable items are minor, major, greater, gold-ring
const THE_LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;

// A second hoard site for the siteDeck so buildTestState doesn't conflict
const MORIA_SITE = 'tw-413' as CardDefinitionId;

// Minor item usable at The Lonely Mountain
const CRAM = 'td-105' as CardDefinitionId;

// Major item usable at The Lonely Mountain
const BOW_OF_DRAGON_HORN = 'td-102' as CardDefinitionId;

// Greater item — should NOT be playable via the bounty (only minor/major)
const ENRUNED_SHIELD = 'td-114' as CardDefinitionId;

describe('Bounty of the Hoard (td-101)', () => {
  beforeEach(() => resetMint());

  // ─── play-window: only playable during site phase ────────────────────────────

  test('not offered during organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: THE_LONELY_MOUNTAIN, characters: [ARAGORN] }], hand: [BOUNTY_OF_THE_HOARD], siteDeck: [MORIA_SITE] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  test('offered during site phase at play-resources step', () => {
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      hand: [BOUNTY_OF_THE_HOARD],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── play-condition active-company: site must contain a hoard ───────────────

  test('not offered at a non-hoard site (rule 5.1.2 — no potential effect)', () => {
    // Minas Tirith has no "hoard" keyword, so setting hoardBountyAvailable
    // there can never unlock an item — the event has no potential effect.
    const state = buildSitePhaseState({
      site: MINAS_TIRITH,
      hand: [BOUNTY_OF_THE_HOARD],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  // ─── core effect: playing the event sets hoardBountyAvailable ────────────────

  test('playing the event sets hoardBountyAvailable in phaseState', () => {
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      hand: [BOUNTY_OF_THE_HOARD],
    });
    const eventInstance = handCardId(state, RESOURCE_PLAYER);

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === eventInstance);
    expect(playActions).toHaveLength(1);

    const next = dispatch(state, playActions[0]);
    expect((next.phaseState as SitePhaseState).hoardBountyAvailable).toBe(true);
  });

  // ─── hoardBountyBonus: allows minor item at tapped hoard site ────────────────

  test('minor item playable at tapped hoard site when bounty is available', () => {
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      siteStatus: CardStatus.Tapped,
      hand: [CRAM],
    });
    const bountyState = {
      ...state,
      phaseState: { ...(state.phaseState), hoardBountyAvailable: true },
    };

    const playActions = viableActions(bountyState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major item playable at tapped hoard site when bounty is available', () => {
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      siteStatus: CardStatus.Tapped,
      hand: [BOW_OF_DRAGON_HORN],
    });
    const bountyState = {
      ...state,
      phaseState: { ...(state.phaseState), hoardBountyAvailable: true },
    };

    const playActions = viableActions(bountyState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── greater items are NOT unlocked by the bounty ────────────────────────────

  test('greater item not playable via bounty at tapped hoard site', () => {
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      siteStatus: CardStatus.Tapped,
      hand: [ENRUNED_SHIELD],
    });
    const bountyState = {
      ...state,
      phaseState: { ...(state.phaseState), hoardBountyAvailable: true },
    };

    const playActions = viableActions(bountyState, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  // ─── bounty has no effect at non-hoard site ──────────────────────────────────

  test('minor item not playable via bounty at tapped non-hoard site', () => {
    const state = buildSitePhaseState({
      site: MINAS_TIRITH,
      siteStatus: CardStatus.Tapped,
      hand: [CRAM],
    });
    const bountyState = {
      ...state,
      phaseState: { ...(state.phaseState), hoardBountyAvailable: true },
    };

    const playActions = viableActions(bountyState, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  // ─── bounty is consumed after one item is played ─────────────────────────────

  test('hoardBountyAvailable is cleared after playing a minor item at tapped hoard site', () => {
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      siteStatus: CardStatus.Tapped,
      hand: [CRAM],
    });
    const bountyState = {
      ...state,
      phaseState: { ...(state.phaseState), hoardBountyAvailable: true },
    };

    const playActions = viableActions(bountyState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(bountyState, playActions[0].action);
    expect((next.phaseState as SitePhaseState).hoardBountyAvailable).toBe(false);
  });

  test('hoardBountyAvailable is cleared after playing a major item at tapped hoard site', () => {
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      siteStatus: CardStatus.Tapped,
      hand: [BOW_OF_DRAGON_HORN],
    });
    const bountyState = {
      ...state,
      phaseState: { ...(state.phaseState), hoardBountyAvailable: true },
    };

    const playActions = viableActions(bountyState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(bountyState, playActions[0].action);
    expect((next.phaseState as SitePhaseState).hoardBountyAvailable).toBe(false);
  });

  // ─── normal item play at untapped site does not consume the bounty ────────────

  test('playing item at untapped hoard site does not consume bounty', () => {
    // Site is untapped (default), bounty is set
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      hand: [CRAM],
    });
    const bountyState = {
      ...state,
      phaseState: { ...(state.phaseState), hoardBountyAvailable: true },
    };

    const playActions = viableActions(bountyState, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(bountyState, playActions[0].action);
    // Site was untapped so item was played normally — bounty should NOT be consumed
    expect((next.phaseState as SitePhaseState).hoardBountyAvailable).toBe(true);
  });

  // ─── bounty not available without the event ──────────────────────────────────

  test('minor item not playable at tapped hoard site without bounty', () => {
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      siteStatus: CardStatus.Tapped,
      hand: [CRAM],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  // ─── full flow: play event, then play item ────────────────────────────────────

  test('full flow: event played at tapped hoard site unlocks minor item play', () => {
    // Start with tapped hoard site, event and item in hand
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      siteStatus: CardStatus.Tapped,
      hand: [BOUNTY_OF_THE_HOARD, CRAM],
    });

    // Item is not playable without the event
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);

    // Play the event
    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    const eventActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === eventInstance);
    expect(eventActions).toHaveLength(1);
    const afterEvent = dispatch(state, eventActions[0]);

    // Bounty is now available
    expect((afterEvent.phaseState as SitePhaseState).hoardBountyAvailable).toBe(true);

    // Item is now playable
    const itemActions = viableActions(afterEvent, PLAYER_1, 'play-hero-resource');
    expect(itemActions.length).toBeGreaterThanOrEqual(1);

    // Play the item — bounty is consumed
    const afterItem = dispatch(afterEvent, itemActions[0].action);
    expect((afterItem.phaseState as SitePhaseState).hoardBountyAvailable).toBe(false);

    // Cram is attached to Aragorn
    const aragornChar = Object.values(afterItem.players[0].characters)
      .find(ch => ch.definitionId === ARAGORN);
    expect(aragornChar?.items.some(i => i.definitionId === CRAM)).toBe(true);
  });
});
