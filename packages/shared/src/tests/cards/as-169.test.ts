/**
 * @module as-169.test
 *
 * Card test: Weathertop (as-169)
 * Type: minion-site (ruins-and-lairs) in Arthedain
 * Effects: 0 (no special rules beyond standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Carn Dûm.
 *   Playable: Information.
 *   Automatic-attacks: Wolves — 2 strikes with 6 prowess.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                 |
 * |---|-------------------|--------|-------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                             |
 * | 2 | sitePath          | OK     | [shadow, wilderness] — matches {s}{w}                 |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion haven (le-359)              |
 * | 4 | region            | OK     | "Arthedain" — adjacent to Angmar                      |
 * | 5 | playableResources | OK     | [information] — matches text                          |
 * | 6 | automaticAttacks  | OK     | Wolves, 2 strikes / 6 prowess                         |
 * | 7 | resourceDraws     | OK     | 1                                                     |
 * | 8 | hazardDraws       | OK     | 1                                                     |
 *
 * Engine Support:
 * | # | Feature                    | Status          | Notes                                         |
 * |---|----------------------------|-----------------|-----------------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED     | select-company, enter-or-skip, play-resources |
 * | 2 | Item-subtype gate          | IMPLEMENTED     | information-only site blocks other subtypes   |
 * | 3 | Haven path movement        | IMPLEMENTED     | Carn Dûm (le-359) ↔ Weathertop (as-169)       |
 * | 4 | Region movement            | IMPLEMENTED     | Angmar adjacent to Arthedain (distance 2)     |
 * | 5 | Automatic attacks at site  | IMPLEMENTED     | Wolves 2/6 triggers combat via pass           |
 *
 * Note: an upstream hero variant (TW-436) exists in the remaster set but is
 * not part of the current MECCG card pool — no cross-variant tests are
 * possible until that hero site is added.
 *
 * Playable: YES
 * Certified: 2026-04-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  viableActions,
  dispatch,
} from '../test-helpers.js';
import {
  CARN_DUM,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const WEATHERTOP = 'as-169' as CardDefinitionId;
// Minor minion item with no item-play-site restriction; its playability at
// Weathertop therefore depends purely on the site's playableResources gate.
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;

describe('Weathertop (as-169)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ───────────────────────────────────────────────────────

  test('automatic attack: Wolves — 2 strikes with 6 prowess', () => {
    const state = buildSitePhaseState({
      site: WEATHERTOP,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(6);
    expect(next.combat!.creatureRace).toBe('wolf');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor item (Saw-toothed Blade) is NOT playable at Weathertop (information-only)', () => {
    const state = buildSitePhaseState({
      site: WEATHERTOP,
      hand: [SAW_TOOTHED_BLADE],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });

  // ─── Starter movement: Carn Dûm ↔ Weathertop ────────────────────────────────

  test('starter movement from Carn Dûm reaches Weathertop', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (WEATHERTOP as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Weathertop reaches Carn Dûm', () => {
    const weathertop = pool[WEATHERTOP as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, weathertop, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CARN_DUM as string),
    );

    expect(starter).toBeDefined();
  });

  test('Weathertop is not a haven, so it does not appear in Carn Dûm havenToHaven links', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(carnDum.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('Weathertop')).toBe(false);
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Carn Dûm reaches Weathertop within 2 regions', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (WEATHERTOP as string),
    );

    // Angmar (Carn Dûm) adjacent to Arthedain (Weathertop) = 2 regions.
    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(2);
  });
});
