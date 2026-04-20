/**
 * @module le-412.test
 *
 * Card test: The White Towers (le-412)
 * Type: minion-site (ruins-and-lairs) in Arthedain
 * Effects: 0 (no special rules beyond the standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Carn Dûm.
 *   Playable: Information.
 *   Automatic-attacks: Wolves — 2 strikes with 6 prowess.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                              |
 * | 2 | sitePath          | OK     | [shadow, wilderness] — matches card {s}{w}             |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion haven in card pool (le-359)  |
 * | 4 | region            | OK     | "Arthedain" — valid region in card pool                |
 * | 5 | playableResources | OK     | [information] — matches card text                      |
 * | 6 | automaticAttacks  | OK     | Wolves, 2 strikes, 6 prowess — matches card text       |
 * | 7 | resourceDraws     | OK     | 2                                                      |
 * | 8 | hazardDraws       | OK     | 2                                                      |
 *
 * Engine Support:
 * | # | Feature                    | Status      | Notes                                              |
 * |---|----------------------------|-------------|----------------------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED | select-company, enter-or-skip, play-resources      |
 * | 2 | Haven path movement        | IMPLEMENTED | movement-map.ts resolves nearestHaven ↔ Carn Dûm   |
 * | 3 | Region movement            | IMPLEMENTED | Arthedain is adjacent to Angmar (Carn Dûm)         |
 * | 4 | Card draws                 | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase|
 * | 5 | Automatic attacks at site  | IMPLEMENTED | combat initiated with correct stats                |
 *
 * Playable: YES
 * Certified: 2026-04-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, ARAGORN,
  resetMint, pool, LORIEN,
  buildSitePhaseState, setupAutoAttackStep,
  dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

const WHITE_TOWERS_LE = 'le-412' as CardDefinitionId;
const WHITE_TOWERS_TW = 'tw-430' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('The White Towers (le-412)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ───────────────────────────────────────────────────────

  test('automatic attack: Wolves — 2 strikes with 6 prowess', () => {
    const state = buildSitePhaseState({
      site: WHITE_TOWERS_LE,
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

  // ─── Movement: Carn Dûm → The White Towers (LE) ────────────────────────────

  test('starter movement from Carn Dûm reaches minion The White Towers (le-412)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterLe412 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (WHITE_TOWERS_LE as string),
    );

    expect(starterLe412).toBeDefined();
  });

  test('starter movement from Carn Dûm does NOT reach hero The White Towers (tw-430)', () => {
    // The hero The White Towers's nearestHaven is Rivendell, not Carn Dûm.
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterTw430 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (WHITE_TOWERS_TW as string),
    );

    expect(starterTw430).toBeUndefined();
  });

  test('starter movement from Dol Guldur does NOT reach minion The White Towers (le-412)', () => {
    // le-412's nearestHaven is Carn Dûm, not Dol Guldur.
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterLe412 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (WHITE_TOWERS_LE as string),
    );

    expect(starterLe412).toBeUndefined();
  });

  test('starter movement from Lórien does NOT reach minion The White Towers (le-412)', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterLe412 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (WHITE_TOWERS_LE as string),
    );

    expect(starterLe412).toBeUndefined();
  });

  // ─── Movement: The White Towers → Carn Dûm ─────────────────────────────────

  test('starter movement from minion The White Towers (le-412) reaches Carn Dûm', () => {
    const whiteTowers = pool[WHITE_TOWERS_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, whiteTowers, allSites);
    const starterCarnDum = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CARN_DUM as string),
    );

    expect(starterCarnDum).toBeDefined();
  });

  test('starter movement from minion The White Towers (le-412) does NOT reach Dol Guldur', () => {
    const whiteTowers = pool[WHITE_TOWERS_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, whiteTowers, allSites);
    const starterDolGuldur = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starterDolGuldur).toBeUndefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Carn Dûm reaches le-412 with distance 2', () => {
    // Carn Dûm is in Angmar; The White Towers is in Arthedain.
    // Angmar and Arthedain are adjacent → 1 edge → regionDistance === 2.
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (WHITE_TOWERS_LE as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(2);
  });

  test('haven-to-haven movement from Carn Dûm does not include le-412 (not a haven)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(carnDum.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('The White Towers')).toBe(false);
  });
});
