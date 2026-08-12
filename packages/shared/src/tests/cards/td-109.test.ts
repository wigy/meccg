/**
 * @module td-109.test
 *
 * Card test: Dwarven Hoard (td-109)
 * Type: hero-resource-event (short, wizard alignment)
 * Text: "Tap a Dwarf at a Dark-hold [{D}] or Shadow-hold [{S}]. The site is
 *   considered to contain a hoard until the end of the turn."
 *
 * Effects:
 * | # | Effect Type   | Notes                                                       |
 * |---|---------------|--------------------------------------------------------------|
 * | 1 | play-window   | site phase, restricted to shadow-hold/dark-hold              |
 * | 2 | play-target   | Dwarf, untapped, company at shadow-hold/dark-hold, tap cost   |
 * | 3 | on-event      | self-enters-play -> set-site-phase-flag(hoardKeywordGranted) |
 *
 * `hoardKeywordGranted` widens `site.keywords` (via `buildActiveCompanyContext`
 * in organization.ts and the item-play-site keyword computation in site.ts) to
 * include "hoard" for the rest of the active company's site phase, regardless
 * of whether the site printed the keyword — unlocking hoard-item playability
 * (e.g. Adamant Helmet td-96) and satisfying other cards' `site.keywords
 * $includes "hoard"` conditions (e.g. Bounty of the Hoard td-101).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
  buildSitePhaseState, buildTestState, resetMint,
  handCardId, dispatch, viableActions,
  findCharInstanceId,
  CardStatus, Phase,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, SitePhaseState, PlayShortEventAction } from '../../index.js';

const DWARVEN_HOARD = 'td-109' as CardDefinitionId;
const BOUNTY_OF_THE_HOARD = 'td-101' as CardDefinitionId;

// Adamant Helmet (td-96): "Hoard item" — item-play-site filter requires
// `site.keywords $includes "hoard"`.
const ADAMANT_HELMET = 'td-96' as CardDefinitionId;

// Cram (td-105): ordinary minor item, no hoard restriction of its own.
const CRAM = 'td-105' as CardDefinitionId;

describe('Dwarven Hoard (td-109)', () => {
  beforeEach(() => resetMint());

  // ── Play restriction: Dwarf at a Dark-hold/Shadow-hold ────────────────────

  test('play-short-event offered for a Dwarf at a shadow-hold', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: MORIA,
      hand: [DWARVEN_HOARD],
    });

    const eventId = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-short-event'
        && (a.action).cardInstanceId === eventId,
    );
    expect(actions).toHaveLength(1);
  });

  test('not offered when company has no Dwarf', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: MORIA,
      hand: [DWARVEN_HOARD],
    });

    const eventId = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-short-event'
        && (a.action).cardInstanceId === eventId,
    );
    expect(actions).toHaveLength(0);
  });

  test('not offered when active company is at a Haven', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: RIVENDELL,
      hand: [DWARVEN_HOARD],
    });

    const eventId = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-short-event'
        && (a.action).cardInstanceId === eventId,
    );
    expect(actions).toHaveLength(0);
  });

  test('not offered during the organization phase', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GIMLI] }], hand: [DWARVEN_HOARD], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const eventId = handCardId(state, RESOURCE_PLAYER);
    const actions = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-short-event'
        && (a.action).cardInstanceId === eventId,
    );
    expect(actions).toHaveLength(0);
  });

  // ── Core effect: taps the Dwarf, grants the hoard keyword ─────────────────

  test('playing the event taps the Dwarf and sets hoardKeywordGranted', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: MORIA,
      hand: [DWARVEN_HOARD],
    });
    const eventId = handCardId(state, RESOURCE_PLAYER);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-short-event'
        && (a.action).cardInstanceId === eventId)
      .map(a => a.action as PlayShortEventAction);
    expect(playActions).toHaveLength(1);
    expect(playActions[0].targetScoutInstanceId).toBe(gimliId);

    const next = dispatch(state, playActions[0]);
    expect(next.players[RESOURCE_PLAYER].characters[gimliId].status).toBe(CardStatus.Tapped);
    expect((next.phaseState as SitePhaseState).hoardKeywordGranted).toBe(true);
  });

  // ── Downstream effect: hoard items become playable at a non-hoard site ────

  test('hoard item not playable at Moria (shadow-hold, no printed hoard keyword) without the flag', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI, ARAGORN],
      site: MORIA,
      hand: [ADAMANT_HELMET],
    });

    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('hoard item becomes playable at Moria once hoardKeywordGranted is set', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI, ARAGORN],
      site: MORIA,
      hand: [ADAMANT_HELMET],
    });
    const grantedState = {
      ...state,
      phaseState: { ...(state.phaseState), hoardKeywordGranted: true },
    };

    expect(viableActions(grantedState, PLAYER_1, 'play-hero-resource').length).toBeGreaterThanOrEqual(1);
  });

  test('full flow: playing Dwarven Hoard unlocks and attaches a hoard item at Moria', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI, ARAGORN],
      site: MORIA,
      hand: [DWARVEN_HOARD, ADAMANT_HELMET],
    });

    // Adamant Helmet is not playable before Dwarven Hoard resolves.
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);

    const eventId = handCardId(state, RESOURCE_PLAYER);
    const eventActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-short-event'
        && (a.action).cardInstanceId === eventId)
      .map(a => a.action as PlayShortEventAction);
    expect(eventActions).toHaveLength(1);

    const afterEvent = dispatch(state, eventActions[0]);
    expect((afterEvent.phaseState as SitePhaseState).hoardKeywordGranted).toBe(true);

    // Adamant Helmet is now playable — Gimli is tapped (paid the Dwarven Hoard
    // cost), so it must be borne by Aragorn instead.
    const itemActions = viableActions(afterEvent, PLAYER_1, 'play-hero-resource');
    expect(itemActions.length).toBeGreaterThanOrEqual(1);

    const afterItem = dispatch(afterEvent, itemActions[0].action);
    const aragornId = findCharInstanceId(afterItem, RESOURCE_PLAYER, ARAGORN);
    expect(afterItem.players[RESOURCE_PLAYER].characters[aragornId].items
      .some(i => i.definitionId === ADAMANT_HELMET)).toBe(true);
  });

  // ── Downstream effect: hoardBountyAvailable's tapped-hoard-site bonus ─────

  test('hoardBountyAvailable bonus applies at a granted (non-printed) hoard site', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [CRAM],
    });
    const bountyState = {
      ...state,
      phaseState: { ...(state.phaseState), hoardKeywordGranted: true, hoardBountyAvailable: true },
    };

    expect(viableActions(bountyState, PLAYER_1, 'play-hero-resource').length).toBeGreaterThanOrEqual(1);
  });

  test('hoardBountyAvailable bonus does not apply at a tapped Moria without the granted flag', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [CRAM],
    });
    const bountyState = {
      ...state,
      phaseState: { ...(state.phaseState), hoardBountyAvailable: true },
    };

    expect(viableActions(bountyState, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ── Downstream effect: satisfies Bounty of the Hoard's own play-condition ─

  test('Bounty of the Hoard becomes playable at Moria once hoardKeywordGranted is set', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: MORIA,
      hand: [BOUNTY_OF_THE_HOARD],
    });

    // Not offered at Moria before the flag — no printed hoard keyword.
    expect(computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-short-event',
    )).toHaveLength(0);

    const grantedState = {
      ...state,
      phaseState: { ...(state.phaseState), hoardKeywordGranted: true },
    };
    expect(computeLegalActions(grantedState, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-short-event',
    ).length).toBeGreaterThanOrEqual(1);
  });
});
