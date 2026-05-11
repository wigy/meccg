/**
 * @module td-180.test
 *
 * Card test: Tharbad (td-180)
 * Type: hero-site (ruins-and-lairs) in Cardolan
 * Effects: 1 — `site-rule: allow-items-when-tapped`
 *
 * Text:
 *   Nearest Haven: Rivendell.
 *   Playable: Items (minor).
 *   Automatic-attacks: Men — 3 strikes with 6 prowess.
 *   Special: Items may be played here even if the site is tapped.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                          |
 * | 2 | sitePath          | OK     | [wilderness, wilderness] — matches {w}{w}          |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool             |
 * | 4 | region            | OK     | "Cardolan"                                         |
 * | 5 | playableResources | OK     | ["minor"] — matches card text                      |
 * | 6 | automaticAttacks  | OK     | Men — 3 strikes at prowess 6                       |
 * | 7 | resourceDraws     | OK     | 1                                                  |
 * | 8 | hazardDraws       | OK     | 1                                                  |
 *
 * Engine Support:
 * | # | Feature                                | Status      | Notes                                       |
 * |---|----------------------------------------|-------------|---------------------------------------------|
 * | 1 | Site phase flow                        | IMPLEMENTED | select-company, enter-or-skip, resources    |
 * | 2 | Item playability (minor only)          | IMPLEMENTED | playableResources gates subtype at site     |
 * | 3 | Haven path movement                    | IMPLEMENTED | movement-map.ts → nearestHaven = Rivendell  |
 * | 4 | `site-rule: allow-items-when-tapped`   | IMPLEMENTED | tapped-site gate bypassed for item plays    |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  RIVENDELL,
  DAGGER_OF_WESTERNESSE, GLAMDRING, THE_MITHRIL_COAT,
  BANDIT_LAIR,
  resetMint, pool,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import { CardStatus, isSiteCard, buildMovementMap, getReachableSites } from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const THARBAD = 'td-180' as CardDefinitionId;

describe('Tharbad (td-180)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability at untapped site ────────────────────────────────────

  test('minor items are playable at untapped Tharbad', () => {
    const state = buildSitePhaseState({
      site: THARBAD,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are NOT playable at Tharbad (only minor listed)', () => {
    const state = buildSitePhaseState({
      site: THARBAD,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  test('greater items are NOT playable at Tharbad', () => {
    const state = buildSitePhaseState({
      site: THARBAD,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  // ─── allow-items-when-tapped: item play at already-tapped Tharbad ─────────

  test('minor item IS offered as viable play at tapped Tharbad', () => {
    const state = buildSitePhaseState({
      site: THARBAD,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
      siteStatus: CardStatus.Tapped,
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('minor item is NOT offered at tapped Bandit Lair (no allow-items-when-tapped)', () => {
    // Bandit Lair (tw-373) is a ruins-and-lairs that also allows minor items
    // but carries no allow-items-when-tapped rule — proves the rule on
    // Tharbad is what enables the play, not the site type or subtype.
    const state = buildSitePhaseState({
      site: BANDIT_LAIR,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
      siteStatus: CardStatus.Tapped,
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  // ─── Movement: Rivendell → Tharbad ────────────────────────────────────────

  test('starter movement from Rivendell reaches Tharbad', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THARBAD as string),
    );
    expect(starterEntry).toBeDefined();
  });

  test('starter movement from Lórien does NOT reach Tharbad (wrong haven)', () => {
    const LORIEN = 'tw-407' as CardDefinitionId;
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THARBAD as string),
    );
    expect(starterEntry).toBeUndefined();
  });
});
