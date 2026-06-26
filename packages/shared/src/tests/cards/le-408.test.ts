/**
 * @module le-408.test
 *
 * Card test: Thranduil’s Halls (le-408)
 * Type: minion-site (free-hold) in the Woodland Realm
 * Effects: 0 (no special rules beyond the standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur.
 *   Playable: Information, Items (minor, major, gold ring).
 *   Automatic-attacks (2):
 *     (1st) Elves — each character faces 1 strike with 9 prowess
 *       (detainment against covert company);
 *     (2nd) Elves — 3 strikes with 10 prowess (against overt company only).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                             |
 * |---|-------------------|--------|-------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                               |
 * | 2 | sitePath          | OK     | [dark, wilderness, shadow] — matches card {d}{w}{s}               |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven in card pool                    |
 * | 4 | region            | OK     | "Woodland Realm" — valid region in card pool                      |
 * | 5 | playableResources | OK     | [information, minor, major, gold-ring] — matches card text        |
 * | 6 | automaticAttacks  | OK     | 2 Elves attacks (each-character detainment-vs-covert + overt-only) |
 * | 7 | resourceDraws     | OK     | 1                                                                 |
 * | 8 | hazardDraws       | OK     | 2                                                                 |
 *
 * Engine Support:
 * | # | Feature                    | Status          | Notes                                                   |
 * |---|----------------------------|-----------------|---------------------------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED     | select-company, enter-or-skip, play-resources           |
 * | 2 | Haven path movement        | IMPLEMENTED     | movement-map.ts resolves nearestHaven ↔ Dol Guldur      |
 * | 3 | Region movement            | IMPLEMENTED     | regional distance from Southern Mirkwood                |
 * | 4 | Card draws                 | IMPLEMENTED     | resourceDraws / hazardDraws thread through M/H phase    |
 * | 5 | Automatic attacks at site  | IMPLEMENTED     | 1st: each-character, detainment gated on defender.covert |
 * |   |                            |                 | 2nd: 3-strike attack restricted to overt (appliesTo)    |
 *
 * Playable: YES (no special effects; all data fields are routed through
 *   engine machinery that is already implemented. The 1st auto-attack is
 *   encoded as strikes: 1 + combatRules ["each-character"] with a
 *   combat-detainment effect gated on defender.covert; the 2nd carries
 *   appliesTo: "overt" so only an overt company faces it.)
 *
 * Certified: 2026-04-19
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { resetMint, pool, LORIEN, PLAYER_1, setupRingwraithAutoAttack } from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import { reduce } from '../../engine/reducer.js';
import type { SiteCard } from '../../index.js';

const THRANDUILS_HALLS_LE = 'le-408' as CardDefinitionId;
const THRANDUILS_HALLS_TW = 'tw-432' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

// Each-character auto-attack fixture: Men keep a Ringwraith company covert; an
// Orc makes it overt (toggling the detainment-vs-covert effect and exposing the
// company to the overt-only 2nd attack).
const THE_MOUTH = 'le-24' as CardDefinitionId;             // Man
const ASTERNAK = 'le-1' as CardDefinitionId;               // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;           // Orc → makes the company overt

describe("Thranduil’s Halls (le-408)", () => {
  beforeEach(() => resetMint());

  // ─── Movement: Dol Guldur → Thranduil’s Halls (LE) ──────────────────────────

  test("starter movement from Dol Guldur reaches Thranduil’s Halls (le-408)", () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterLe408 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THRANDUILS_HALLS_LE as string),
    );

    expect(starterLe408).toBeDefined();
  });

  test("starter movement from Dol Guldur does NOT reach hero Thranduil’s Halls (tw-432)", () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterTw432 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THRANDUILS_HALLS_TW as string),
    );

    expect(starterTw432).toBeUndefined();
  });

  test("starter movement from Lórien does NOT reach minion Thranduil’s Halls (le-408)", () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterLe408 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THRANDUILS_HALLS_LE as string),
    );

    expect(starterLe408).toBeUndefined();
  });

  // ─── Movement: Thranduil’s Halls → Dol Guldur ───────────────────────────────

  test("starter movement from Thranduil’s Halls (le-408) reaches Dol Guldur", () => {
    const thranduilsHalls = pool[THRANDUILS_HALLS_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, thranduilsHalls, allSites);
    const starterDolGuldur = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starterDolGuldur).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Dol Guldur reaches le-408 within 4 regions', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (THRANDUILS_HALLS_LE as string),
    );

    // Southern Mirkwood (Dol Guldur) → Heart of Mirkwood → Woodland Realm.
    // That's 3 consecutive regions, so regionDistance === 3.
    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('haven-to-haven movement from Dol Guldur does not include le-408 (not a haven)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(dolGuldur.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has("Thranduil’s Halls")).toBe(false);
  });

  // ─── Automatic attacks: 1st Elves each-character, 2nd overt-only ────────────
  // Engine-driven regression for the each-character encoding (strikes: 1 +
  // combatRules ["each-character"]) on the 1st attack and appliesTo: "overt"
  // on the 2nd. The first pass triggers the 1st (each-character) attack.

  test('each-character: 1st Elves attack pre-assigns one strike per character (strikesTotal = company size)', () => {
    const state = setupRingwraithAutoAttack(THRANDUILS_HALLS_LE, [THE_MOUTH, ASTERNAK, ORC_CAPTAIN]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('elf');
    expect(after.combat!.strikeProwess).toBe(9);
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.eachCharacterFacesOneStrike).toBe(true);
    expect(after.combat!.phase).not.toBe('assign-strikes');
    expect(after.combat!.assignmentPhase).toBe('done');
  });

  test('covert company: the 1st Elves each-character attack is detainment', () => {
    const state = setupRingwraithAutoAttack(THRANDUILS_HALLS_LE, [THE_MOUTH, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(true);
  });

  test('overt company: the 1st Elves each-character attack is NOT detainment', () => {
    const state = setupRingwraithAutoAttack(THRANDUILS_HALLS_LE, [ORC_CAPTAIN, THE_MOUTH]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(false);
  });
});
