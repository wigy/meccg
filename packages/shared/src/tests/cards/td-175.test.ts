/**
 * @module td-175.test
 *
 * Card test: Framsburg (td-175) — NOT CERTIFIED.
 *
 * Framsburg's printed auto-attack ("When a company enters this site,
 * opponent may play one creature from his hand that is treated in all
 * ways as the site's automatic-attack, keyed to {R}/{S}/{w}/{s}") is a
 * dynamic, player-authored auto-attack the engine does not yet support.
 * Until that mechanic ships, the card is only partially playable and
 * MUST NOT carry a `certified` date.
 *
 * This file covers only the engine features that DO work for Framsburg:
 * item playability (minor, hoard-keyword gating) and haven/region
 * movement. It is a regression guard for the partial state — it is not
 * a certification.
 *
 * Text:
 *   Nearest Haven: Lórien.
 *   Playable: Items (minor).
 *   Automatic-attacks: When a company enters this site, opponent may play
 *     one creature from his hand that is treated in all ways as the site's
 *     automatic-attack (if defeated, creature is discarded). It must
 *     normally be playable keyed to a Ruins & Lairs [{R}], Shadow-hold
 *     [{S}], single Wilderness [{w}], or Shadow-land [{s}].
 *   Special: Contains a hoard.
 *
 * Playable: PARTIALLY — dynamic opponent-chosen auto-attack from hand
 *   is NOT IMPLEMENTED. Revisit when the engine supports player-authored
 *   auto-attacks with a keying filter.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, ARAGORN,
  DAGGER_OF_WESTERNESSE, GLAMDRING, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  resetMint, pool,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import {
  LORIEN, RIVENDELL,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, CardDefinitionId } from '../../index.js';

const FRAMSBURG = 'td-175' as CardDefinitionId;
const ADAMANT_HELMET = 'td-96' as CardDefinitionId;

describe('Framsburg (td-175)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Framsburg', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are NOT playable at Framsburg (only minor allowed)', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('greater items are NOT playable at Framsburg', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('gold-ring items are NOT playable at Framsburg', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('hoard minor item (Adamant Helmet) is playable at Framsburg (site contains a hoard)', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [ADAMANT_HELMET],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: FRAMSBURG });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // Automatic attacks — the card's actual auto-attack rule (opponent plays
  // a creature from hand as the site's auto-attack) is not implemented by
  // the engine, so it is NOT tested here. This is why the card is not
  // certified.

  // ─── Movement: Lórien → Framsburg ───────────────────────────────────────────

  test('starter movement from Lórien reaches Framsburg', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (FRAMSBURG as string),
    );

    expect(starterEntry).toBeDefined();
  });

  test('starter movement from Rivendell does NOT reach Framsburg', () => {
    // Framsburg's nearestHaven is Lórien, so Rivendell's starter movement
    // should not include it.
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (FRAMSBURG as string),
    );

    expect(starterEntry).toBeUndefined();
  });

  // ─── Movement: Framsburg → Lórien ───────────────────────────────────────────

  test('starter movement from Framsburg reaches Lórien', () => {
    const framsburg = pool[FRAMSBURG as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, framsburg, allSites);
    const starterLorien = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LORIEN as string),
    );

    expect(starterLorien).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Lórien reaches Framsburg (Anduin Vales adjacent to Wold & Foothills)', () => {
    // Lórien is in Wold & Foothills; Framsburg is in Anduin Vales — adjacent
    // regions → 1 edge → regionDistance === 2.
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (FRAMSBURG as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(2);
  });
});
