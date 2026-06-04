/**
 * @module le-379.test
 *
 * Card test: Gondmaeglom (le-379)
 * Type: minion-site (ruins-and-lairs) in Grey Mountain Narrows
 * Effects: 0 (no special rules beyond standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur.
 *   Playable: Items (minor, major, gold ring).
 *   Automatic-attacks: Dragon — 1 strike with 14 prowess.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                          |
 * |---|-------------------|--------|----------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                      |
 * | 2 | sitePath          | OK     | [dark, wilderness, wilderness, shadow] ↔ {d}{w}{w}{s}          |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven in card pool (le-367)        |
 * | 4 | region            | OK     | "Grey Mountain Narrows" — valid region in card pool            |
 * | 5 | playableResources | OK     | [minor, major, gold-ring] — matches card text                  |
 * | 6 | automaticAttacks  | OK     | Dragon, 1 strike, 14 prowess — matches card text               |
 * | 7 | resourceDraws     | OK     | 2                                                              |
 * | 8 | hazardDraws       | OK     | 2                                                              |
 *
 * Engine Support:
 * | # | Feature                   | Status      | Notes                                                 |
 * |---|---------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow           | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | Item playability          | IMPLEMENTED | minor, major, gold-ring checked against site subtype  |
 * | 3 | Haven path movement       | IMPLEMENTED | movement-map.ts resolves nearestHaven ↔ Dol Guldur    |
 * | 4 | Region movement           | IMPLEMENTED | Grey Mountain Narrows via Anduin Vales (distance 3)   |
 * | 5 | Card draws                | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase  |
 * | 6 | Automatic attack at site  | IMPLEMENTED | Dragon 1×14 initiated with correct stats              |
 *
 * Playable: YES
 * Certified: 2026-06-04
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, ARAGORN,
  DAGGER_OF_WESTERNESSE, GLAMDRING, PRECIOUS_GOLD_RING,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  viableActions, dispatch,
} from '../test-helpers.js';
import {
  LORIEN,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, CardDefinitionId } from '../../index.js';

const GONDMAEGLOM = 'le-379' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

describe('Gondmaeglom (le-379)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ────────────────────────────────────────────────────────

  test('automatic attack: Dragon — 1 strike with 14 prowess', () => {
    const state = buildSitePhaseState({
      site: GONDMAEGLOM,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(14);
    expect(next.combat!.creatureRace).toBe('dragon');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor items are playable at Gondmaeglom', () => {
    const state = buildSitePhaseState({
      site: GONDMAEGLOM,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Gondmaeglom', () => {
    const state = buildSitePhaseState({
      site: GONDMAEGLOM,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring items are playable at Gondmaeglom', () => {
    const state = buildSitePhaseState({
      site: GONDMAEGLOM,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Movement: Dol Guldur → Gondmaeglom ─────────────────────────────────────

  test('starter movement from Dol Guldur reaches Gondmaeglom', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterGondmaeglom = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GONDMAEGLOM as string),
    );

    expect(starterGondmaeglom).toBeDefined();
  });

  test('starter movement from Carn Dûm does NOT reach Gondmaeglom', () => {
    // Gondmaeglom's nearestHaven is Dol Guldur, not Carn Dûm.
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterGondmaeglom = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GONDMAEGLOM as string),
    );

    expect(starterGondmaeglom).toBeUndefined();
  });

  test('starter movement from Minas Morgul does NOT reach Gondmaeglom', () => {
    // Gondmaeglom's nearestHaven is Dol Guldur, not Minas Morgul.
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterGondmaeglom = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GONDMAEGLOM as string),
    );

    expect(starterGondmaeglom).toBeUndefined();
  });

  test('starter movement from Lórien does NOT reach Gondmaeglom', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterGondmaeglom = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GONDMAEGLOM as string),
    );

    expect(starterGondmaeglom).toBeUndefined();
  });

  // ─── Movement: Gondmaeglom → Dol Guldur ─────────────────────────────────────

  test('starter movement from Gondmaeglom reaches Dol Guldur', () => {
    const gondmaeglom = pool[GONDMAEGLOM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, gondmaeglom, allSites);
    const starterDolGuldur = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starterDolGuldur).toBeDefined();
  });

  // ─── Region movement ─────────────────────────────────────────────────────────

  test('region movement from Dol Guldur reaches Gondmaeglom with distance 3', () => {
    // Dol Guldur is in Southern Mirkwood; Gondmaeglom is in Grey Mountain Narrows.
    // Southern Mirkwood → Anduin Vales → Grey Mountain Narrows = 2 edges → regionDistance 3.
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (GONDMAEGLOM as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('haven-to-haven movement from Dol Guldur does not include Gondmaeglom (not a haven)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(dolGuldur.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('Gondmaeglom')).toBe(false);
  });
});
