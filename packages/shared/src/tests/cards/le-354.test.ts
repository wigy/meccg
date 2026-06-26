/**
 * @module le-354.test
 *
 * Card test: Beorn’s House (le-354)
 * Type: minion-site (free-hold)
 * Effects: 0
 *
 * "Nearest Darkhaven: Dol Guldur
 *  Playable: Items (gold ring)
 *  Automatic-attacks: Men — each character faces 1 strike with 10 prowess
 *  (detainment against covert company)"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                |
 * |---|-------------------|--------|------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                  |
 * | 2 | sitePath          | OK     | [dark, shadow] — matches {d}{s}                      |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367)           |
 * | 4 | region            | OK     | "Anduin Vales" — adjacent to Dol Guldur's region     |
 * | 5 | playableResources | OK     | [gold-ring] — matches text                           |
 * | 6 | automaticAttacks  | OK     | Men, prowess 10, each-character / detainment-vs-covert |
 * | 7 | resourceDraws     | OK     | 1                                                    |
 * | 8 | hazardDraws       | OK     | 1                                                    |
 *
 * Engine Support:
 * | # | Feature                 | Status         | Notes                              |
 * |---|-------------------------|----------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED    | select-company, enter-or-skip, etc. |
 * | 2 | Haven path movement     | IMPLEMENTED    | movement-map.ts                     |
 * | 3 | Region movement         | IMPLEMENTED    | sites reachable within 4 regions    |
 * | 4 | Card draws              | IMPLEMENTED    | resourceDraws/hazardDraws used      |
 * | 5 | Automatic attack combat | IMPLEMENTED    | each-character: one strike per character; detainment   |
 * |   |                         |                | gated on defender.covert (combat-detainment effect)    |
 *
 * Playable: YES
 * Certified: 2026-04-19
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

const BEORNS_HOUSE = 'le-354' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

// Each-character auto-attack fixture: Men keep a Ringwraith company covert; an
// Orc makes it overt (toggling the detainment-vs-covert effect).
const THE_MOUTH = 'le-24' as CardDefinitionId;             // Man
const ASTERNAK = 'le-1' as CardDefinitionId;               // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;           // Orc → makes the company overt

describe("Beorn’s House (le-354)", () => {
  beforeEach(() => resetMint());

  test('reachable from Dol Guldur via starter movement', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain("Beorn’s House");
  });

  test("starter movement from Beorn’s House returns to Dol Guldur", () => {
    const beornsHouse = pool[BEORNS_HOUSE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, beornsHouse, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Dol Guldur');
  });

  test('reachable from Dol Guldur via region movement with distance 2', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === "Beorn’s House",
    );

    expect(regionEntry).toBeDefined();
    // Southern Mirkwood → Anduin Vales (adjacent regions) = 2
    expect(regionEntry!.regionDistance).toBe(2);
  });

  test('not reachable from Minas Morgul via starter movement', () => {
    // Beorn’s House's nearest haven is Dol Guldur, not Minas Morgul
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain("Beorn’s House");
  });

  // ─── Automatic attack: Men, each character faces 1 strike ───────────────────
  // Engine-driven regression for the each-character encoding (strikes: 1 +
  // combatRules ["each-character"]); detainment gated on defender.covert.

  test('each-character: Men attack pre-assigns one strike per character (strikesTotal = company size)', () => {
    const state = setupRingwraithAutoAttack(BEORNS_HOUSE, [THE_MOUTH, ASTERNAK, ORC_CAPTAIN]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.strikeProwess).toBe(10);
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.eachCharacterFacesOneStrike).toBe(true);
    expect(after.combat!.phase).not.toBe('assign-strikes');
    expect(after.combat!.assignmentPhase).toBe('done');
  });

  test('covert company: the Men each-character attack is detainment', () => {
    const state = setupRingwraithAutoAttack(BEORNS_HOUSE, [THE_MOUTH, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(true);
  });

  test('overt company: the Men each-character attack is NOT detainment', () => {
    const state = setupRingwraithAutoAttack(BEORNS_HOUSE, [ORC_CAPTAIN, THE_MOUTH]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(false);
  });
});
