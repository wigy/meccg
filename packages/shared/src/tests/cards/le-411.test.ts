/**
 * @module le-411.test
 *
 * Card test: Variag Camp (le-411)
 * Type: minion-site (border-hold) in Khand
 * Effects: 1 — combat-detainment gated on defender.covert
 *
 * Text:
 *   Nearest Darkhaven: Minas Morgul.
 *   Automatic-attacks: Men — each character faces 1 strike with 5 prowess
 *     (detainment against covert company).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                  |
 * | 2 | nearestHaven      | OK     | "Minas Morgul" — valid minion haven (le-390)           |
 * | 3 | region            | OK     | "Khand" — valid region in card pool                    |
 * | 4 | automaticAttacks  | OK     | Men, prowess 5, each-character / detainment-vs-covert  |
 * | 5 | resourceDraws     | OK     | 2                                                      |
 * | 6 | hazardDraws       | OK     | 2                                                      |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                                              |
 * |---|-------------------------|-------------|----------------------------------------------------|
 * | 1 | Haven path movement     | IMPLEMENTED | movement-map.ts resolves nearestHaven ↔ Minas Morgul |
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

const VARIAG_CAMP = 'le-411' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

// Each-character auto-attack fixture: Men keep a Ringwraith company covert; an
// Orc makes it overt (toggling the detainment-vs-covert effect).
const THE_MOUTH = 'le-24' as CardDefinitionId;             // Man
const ASTERNAK = 'le-1' as CardDefinitionId;               // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;           // Orc → makes the company overt

describe('Variag Camp (le-411)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Minas Morgul ↔ Variag Camp ───────────────────────────────────

  test('starter movement from Minas Morgul reaches Variag Camp (le-411)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (VARIAG_CAMP as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Variag Camp returns to Minas Morgul', () => {
    const variagCamp = pool[VARIAG_CAMP as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, variagCamp, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MINAS_MORGUL as string),
    );

    expect(starter).toBeDefined();
  });

  // ─── Automatic attack: Men, each character faces 1 strike ───────────────────
  // Engine-driven regression for the each-character encoding (strikes: 1 +
  // combatRules ["each-character"]); detainment gated on defender.covert.

  test('each-character: Men attack pre-assigns one strike per character (strikesTotal = company size)', () => {
    const state = setupRingwraithAutoAttack(VARIAG_CAMP, [THE_MOUTH, ASTERNAK, ORC_CAPTAIN]);

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
    const state = setupRingwraithAutoAttack(VARIAG_CAMP, [THE_MOUTH, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(true);
  });

  test('overt company: the Men each-character attack is NOT detainment', () => {
    const state = setupRingwraithAutoAttack(VARIAG_CAMP, [ORC_CAPTAIN, THE_MOUTH]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(false);
  });
});
