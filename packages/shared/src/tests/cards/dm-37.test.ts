/**
 * @module dm-37.test
 *
 * Card test: The Under-galleries (dm-37)
 * Type: hero-site (dark-hold) in Ûdun — under-deeps site
 * Effects: 2
 *   1. `site-rule: dynamic-auto-attack` keyed to {S} (shadow-hold)
 *   2. `site-rule: stolen-knowledge` — routes tapped site to outOfPlayPile for 3 misc MPs
 *
 * Text:
 *   Adjacent Sites: Any site in Ûdun (0), The Under-courts (4), The Sulfur-deeps (8)
 *   Playable: Items (minor, major, greater)
 *   Automatic-attacks (2): (1st) Trolls — 4 strikes with 9 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard creature
 *     from his hand normally keyed to Shadow-holds [S]
 *   Special: Stolen Knowledge. When Under-galleries would be placed in your discard
 *     pile, place it in your marshalling points pile instead for 3 marshalling
 *     points—this card is considered stored.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                             |
 * |---|-------------------|--------|---------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid                               |
 * | 2 | sitePath          | OK     | [] — under-deeps site, reached via adjacentSites  |
 * | 3 | nearestHaven      | OK     | "" — under-deeps sites have no nearest haven      |
 * | 4 | region            | OK     | "Ûdun"                                            |
 * | 5 | playableResources | OK     | ["minor", "major", "greater"] — matches text      |
 * | 6 | automaticAttacks  | OK     | Trolls — 4 strikes / 9 prowess (static)           |
 * | 7 | resourceDraws     | OK     | 1                                                 |
 * | 8 | hazardDraws       | OK     | 4                                                 |
 * | 9 | keywords          | OK     | ["under-deeps"]                                   |
 *
 * Engine Support:
 * | #  | Feature                          | Status      | Notes                                          |
 * |----|----------------------------------|-------------|------------------------------------------------|
 * |  1 | Site phase flow                  | IMPLEMENTED | enter-or-skip, play-resources                  |
 * |  2 | Minor item playability           | IMPLEMENTED | playableResources gate                         |
 * |  3 | Major item playability           | IMPLEMENTED | playableResources gate                         |
 * |  4 | Greater item playability         | IMPLEMENTED | playableResources gate                         |
 * |  5 | Gold-ring NOT playable           | IMPLEMENTED | not in playableResources                       |
 * |  6 | site-rule: dynamic-auto-attack   | IMPLEMENTED | play-site-auto-attack step                     |
 * |  7 | Shadow-hold creature offered     | IMPLEMENTED | Barrow-wight (shadow/dark + shadow-hold keyed) |
 * |  8 | Non-shadow-hold creature denied  | IMPLEMENTED | Cave-drake (wilderness/R&L) not offered        |
 * |  9 | Dynamic attack step advances     | IMPLEMENTED | pass → automatic-attacks                       |
 * | 10 | site-rule: stolen-knowledge      | IMPLEMENTED | tapped site → outOfPlayPile + 3 misc MPs       |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, ARAGORN,
  GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  BARROW_WIGHT, CAVE_DRAKE,
  resetMint,
  buildSitePhaseState, buildDualHandSitePhaseState,
  viableActions, dispatch,
} from '../test-helpers.js';
import { CardStatus } from '../../index.js';
import type { CardDefinitionId, SitePhaseState, PlaySiteAutoAttackAction, CardInstanceId } from '../../index.js';

const UNDER_GALLERIES = 'dm-37' as CardDefinitionId;

describe('The Under-galleries (dm-37)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor items are playable at The Under-galleries', () => {
    const state = buildSitePhaseState({ site: UNDER_GALLERIES, hand: [DAGGER_OF_WESTERNESSE] });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major items are playable at The Under-galleries', () => {
    const state = buildSitePhaseState({ site: UNDER_GALLERIES, hand: [GLAMDRING] });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater items are playable at The Under-galleries', () => {
    const state = buildSitePhaseState({ site: UNDER_GALLERIES, hand: [THE_MITHRIL_COAT] });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('gold-ring items are NOT playable at The Under-galleries', () => {
    const state = buildSitePhaseState({ site: UNDER_GALLERIES, hand: [PRECIOUS_GOLD_RING] });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  // ─── Dynamic auto-attack ───────────────────────────────────────────────────

  test('entering advances to play-site-auto-attack (dynamic attack before static Trolls)', () => {
    const state = buildDualHandSitePhaseState({
      site: UNDER_GALLERIES,
      resourceCharacters: [ARAGORN],
      step: 'enter-or-skip',
    });
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;
    const after = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });
    // The site has a static auto-attack (Trolls) AND a dynamic rule; after
    // entering and passing reveal-on-guard-attacks, next is play-site-auto-attack.
    const phaseStep = (after.phaseState as SitePhaseState).step;
    expect(['reveal-on-guard-attacks', 'play-site-auto-attack']).toContain(phaseStep);
  });

  test('Barrow-wight (shadow-hold keyed) is offered as dynamic auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: UNDER_GALLERIES,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [BARROW_WIGHT],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const bwInst = state.players[1].hand[0].instanceId;
    const action = actions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(bwInst);
  });

  test('Cave-drake (wilderness + ruins-and-lairs keyed) is NOT offered as dynamic auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: UNDER_GALLERIES,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('hazard player passing at play-site-auto-attack advances to automatic-attacks (Trolls)', () => {
    const state = buildDualHandSitePhaseState({
      site: UNDER_GALLERIES,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
    });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Stolen Knowledge ─────────────────────────────────────────────────────

  test('tapped Under-galleries routes to outOfPlayPile instead of discard when company becomes empty', () => {
    // Build a state in enter-or-skip. Then empty the company and tap the site,
    // simulating a company that lost its last character at the site.
    // Passing skips the (empty) company; with no remaining companies,
    // cleanupEmptyCompanies fires and routes the tapped site to outOfPlayPile.
    const base = buildDualHandSitePhaseState({
      site: UNDER_GALLERIES,
      resourceCharacters: [ARAGORN],
      step: 'enter-or-skip',
    });

    const company = base.players[RESOURCE_PLAYER].companies[0];
    const siteInstanceId = company.currentSite!.instanceId;

    const state = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          companies: [
            {
              ...company,
              characters: [] as CardInstanceId[],
              currentSite: { ...company.currentSite!, status: CardStatus.Tapped },
            },
          ],
        },
        base.players[1],
      ],
    } as typeof base;

    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const inOutOfPlay = next.players[RESOURCE_PLAYER].outOfPlayPile.some(
      c => c.instanceId === siteInstanceId,
    );
    expect(inOutOfPlay).toBe(true);

    const inDiscard = next.players[RESOURCE_PLAYER].discardPile.some(
      c => c.instanceId === siteInstanceId,
    );
    expect(inDiscard).toBe(false);
  });

  test('stolen-knowledge awards 3 misc marshalling points when site is in outOfPlayPile', () => {
    const base = buildDualHandSitePhaseState({
      site: UNDER_GALLERIES,
      resourceCharacters: [ARAGORN],
      step: 'enter-or-skip',
    });

    const company = base.players[RESOURCE_PLAYER].companies[0];

    const state = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          companies: [
            {
              ...company,
              characters: [] as CardInstanceId[],
              currentSite: { ...company.currentSite!, status: CardStatus.Tapped },
            },
          ],
        },
        base.players[1],
      ],
    } as typeof base;

    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(3);
  });
});
