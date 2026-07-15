/**
 * @module le-414.test
 *
 * Card test: Woodmen-town (le-414)
 * Type: minion-site (border-hold) in Western Mirkwood
 * Effects: 1 — combat-detainment gated on defender.covert
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur.
 *   Automatic-attacks: Men — each character faces 1 strike with 6 prowess
 *     (detainment against covert company).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid ({B})                            |
 * | 2 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367)             |
 * | 3 | region            | OK     | "Western Mirkwood" — valid region in card pool         |
 * | 4 | sitePath          | OK     | [dark, wilderness] — {d}{w}                            |
 * | 5 | automaticAttacks  | OK     | Men, prowess 6, each-character / detainment-vs-covert  |
 * | 6 | resourceDraws     | OK     | 1                                                      |
 * | 7 | hazardDraws       | OK     | 1                                                      |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                                              |
 * |---|-------------------------|-------------|----------------------------------------------------|
 * | 1 | Haven path movement     | IMPLEMENTED | movement-map.ts resolves nearestHaven ↔ Dol Guldur |
 * | 2 | Automatic attack combat | IMPLEMENTED | each-character: one strike per character; detainment |
 * |   |                         |             | gated on defender.covert (combat-detainment effect) |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { resetMint, pool, PLAYER_1, setupRingwraithAutoAttack } from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import { reduce } from '../../engine/reducer.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const WOODMEN_TOWN = 'le-414' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

// Each-character auto-attack fixture: Men keep a Ringwraith company covert; an
// Orc makes it overt (toggling the detainment-vs-covert effect).
const THE_MOUTH = 'le-24' as CardDefinitionId;             // Man
const ASTERNAK = 'le-1' as CardDefinitionId;               // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;           // Orc → makes the company overt

describe('Woodmen-town (le-414)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Dol Guldur ↔ Woodmen-town ────────────────────────────────────

  test('starter movement from Dol Guldur reaches Woodmen-town (le-414)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (WOODMEN_TOWN as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Woodmen-town returns to Dol Guldur', () => {
    const woodmenTown = pool[WOODMEN_TOWN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, woodmenTown, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starter).toBeDefined();
  });

  // ─── Automatic attack: Men, each character faces 1 strike ───────────────────
  // Engine-driven regression for the each-character encoding (strikes: 1 +
  // combatRules ["each-character"]); prowess 6; detainment gated on defender.covert.

  test('each-character: Men attack pre-assigns one strike per character (strikesTotal = company size)', () => {
    const state = setupRingwraithAutoAttack(WOODMEN_TOWN, [THE_MOUTH, ASTERNAK, ORC_CAPTAIN]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.strikeProwess).toBe(6);
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.eachCharacterFacesOneStrike).toBe(true);
    expect(after.combat!.phase).not.toBe('assign-strikes');
    expect(after.combat!.assignmentPhase).toBe('done');
  });

  test('covert company: the Men each-character attack is detainment', () => {
    const state = setupRingwraithAutoAttack(WOODMEN_TOWN, [THE_MOUTH, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(true);
  });

  test('overt company: the Men each-character attack is NOT detainment', () => {
    const state = setupRingwraithAutoAttack(WOODMEN_TOWN, [ORC_CAPTAIN, THE_MOUTH]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(false);
  });
});
