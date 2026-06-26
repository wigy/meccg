/**
 * @module le-363.test
 *
 * Card test: Dale (le-363)
 * Type: minion-site (border-hold)
 * Effects: 0
 *
 * "Nearest Darkhaven: Dol Guldur
 *  Playable: Items (gold ring)
 *  Automatic-attacks: Men — each character faces 1 strike with 5 prowess
 *  (detainment against covert company)"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                         |
 * |---|-------------------|--------|---------------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                         |
 * | 2 | sitePath          | OK     | [dark, wilderness, wilderness] — matches {d}{w}{w}            |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367)                    |
 * | 4 | region            | OK     | "Northern Rhovanion" — valid region in card pool              |
 * | 5 | playableResources | OK     | [gold-ring] — matches text                                    |
 * | 6 | automaticAttacks  | OK     | Men, prowess 5, each-character / detainment-vs-covert         |
 * | 7 | resourceDraws     | OK     | 2                                                             |
 * | 8 | hazardDraws       | OK     | 2                                                             |
 *
 * Engine Support:
 * | # | Feature                 | Status         | Notes                                        |
 * |---|-------------------------|----------------|----------------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED    | select-company, enter-or-skip, play-resources |
 * | 2 | Haven path movement     | IMPLEMENTED    | movement-map.ts resolves nearestHaven → Dol Guldur |
 * | 3 | Region movement         | IMPLEMENTED    | regional distance from Southern Mirkwood      |
 * | 4 | Card draws              | IMPLEMENTED    | resourceDraws/hazardDraws used                |
 * | 5 | Automatic attack combat | IMPLEMENTED    | each-character: one strike per character; detainment   |
 * |   |                         |                | gated on defender.covert (combat-detainment effect)    |
 *
 * Playable: YES
 * Certified: 2026-06-04
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { resetMint, pool, PLAYER_1, setupRingwraithAutoAttack } from '../test-helpers.js';
import {
  isSiteCard,
  buildMovementMap,
  getReachableSites,
} from '../../index.js';
import { reduce } from '../../engine/reducer.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const DALE_MINION = 'le-363' as CardDefinitionId;
const DALE_HERO = 'td-174' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

// Each-character auto-attack fixture: Men keep a Ringwraith company covert; an
// Orc makes it overt (toggling the detainment-vs-covert effect).
const THE_MOUTH = 'le-24' as CardDefinitionId;             // Man
const ASTERNAK = 'le-1' as CardDefinitionId;               // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;           // Orc → makes the company overt

describe('Dale (le-363)', () => {
  beforeEach(() => resetMint());

  test('starter movement from Dol Guldur reaches Dale (le-363)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DALE_MINION as string),
    );

    expect(starterEntry).toBeDefined();
  });

  test('starter movement from Dol Guldur does NOT reach hero Dale (td-174)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DALE_HERO as string),
    );

    expect(starterEntry).toBeUndefined();
  });

  test('starter movement from Dale (le-363) reaches Dol Guldur', () => {
    const dale = pool[DALE_MINION as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dale, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starterEntry).toBeDefined();
  });

  test('starter movement from Minas Morgul does NOT reach Dale (le-363)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DALE_MINION as string),
    );

    expect(starterEntry).toBeUndefined();
  });

  test('region movement from Dol Guldur reaches Dale (le-363) with distance 3', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (DALE_MINION as string),
    );

    // Southern Mirkwood → Heart of Mirkwood → Northern Rhovanion = 2 edges → regionDistance 3
    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('haven-to-haven movement from Dol Guldur does not include Dale (not a haven)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(dolGuldur.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('Dale')).toBe(false);
  });

  // ─── Automatic attack: Men, each character faces 1 strike ───────────────────
  // Engine-driven regression for the each-character encoding (strikes: 1 +
  // combatRules ["each-character"]); detainment gated on defender.covert.

  test('each-character: Men attack pre-assigns one strike per character (strikesTotal = company size)', () => {
    const state = setupRingwraithAutoAttack(DALE_MINION, [THE_MOUTH, ASTERNAK, ORC_CAPTAIN]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.strikeProwess).toBe(5);
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.eachCharacterFacesOneStrike).toBe(true);
    expect(after.combat!.phase).not.toBe('assign-strikes');
    expect(after.combat!.assignmentPhase).toBe('done');
  });

  test('covert company: the Men each-character attack is detainment', () => {
    const state = setupRingwraithAutoAttack(DALE_MINION, [THE_MOUTH, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(true);
  });

  test('overt company: the Men each-character attack is NOT detainment', () => {
    const state = setupRingwraithAutoAttack(DALE_MINION, [ORC_CAPTAIN, THE_MOUTH]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(false);
  });
});
