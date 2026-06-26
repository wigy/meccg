/**
 * @module le-372.test
 *
 * Card test: Edoras (le-372)
 * Type: minion-site (free-hold) in Rohan
 * Effects: 0 (no special rules beyond the standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Minas Morgul.
 *   Playable: Items (gold ring).
 *   Automatic-attacks: Men — each character faces 1 strike with 10 prowess
 *     (detainment against covert company).
 *
 * Two sites share the name "Edoras": the hero version at tw-394 (keyed to
 * Lórien) and this minion version at le-372 (keyed to Minas Morgul). The
 * movement tests below check that the minion version is reachable from the
 * minion starter haven only, not from Lórien.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                                  |
 * |---|-------------------|--------|------------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                                    |
 * | 2 | sitePath          | OK     | [shadow, wilderness, free, shadow] — matches card {s}{w}{f}{s}         |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion haven in card pool (le-390)              |
 * | 4 | region            | OK     | "Rohan" — reachable from Imlad Morgul within 4 regions                 |
 * | 5 | playableResources | OK     | [gold-ring] — matches card text                                        |
 * | 6 | automaticAttacks  | OK     | Men, prowess 10, each-character / detainment-vs-covert                 |
 * | 7 | resourceDraws     | OK     | 2                                                                      |
 * | 8 | hazardDraws       | OK     | 3                                                                      |
 *
 * Engine Support:
 * | # | Feature                    | Status          | Notes                                                  |
 * |---|----------------------------|-----------------|--------------------------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED     | select-company, enter-or-skip, play-resources          |
 * | 2 | Haven path movement        | IMPLEMENTED     | movement-map.ts resolves nearestHaven ↔ Minas Morgul   |
 * | 3 | Region movement            | IMPLEMENTED     | region distance via Ithilien → Anórien → Rohan         |
 * | 4 | Card draws                 | IMPLEMENTED     | resourceDraws / hazardDraws thread through M/H phase   |
 * | 5 | Automatic attacks at site  | IMPLEMENTED     | each-character: one strike per character; detainment   |
 * |   |                            |                 | gated on defender.covert (combat-detainment effect)    |
 *
 * Playable: YES (no special effects; the card's data fields all route
 *   through engine machinery that is already implemented. The
 *   "each character faces 1 strike" auto-attack is encoded as
 *   strikes: 1 + combatRules ["each-character"], with detainment-vs-covert
 *   expressed by a combat-detainment effect gated on defender.covert.)
 *
 * Certified: 2026-04-19
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { resetMint, pool, LORIEN, PLAYER_1, setupRingwraithAutoAttack } from '../test-helpers.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import { reduce } from '../../engine/reducer.js';

const EDORAS_LE = 'le-372' as CardDefinitionId;
const EDORAS_TW = 'tw-394' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

// Each-character auto-attack fixture: Men keep a Ringwraith company covert; an
// Orc makes it overt (toggling the detainment-vs-covert effect).
const THE_MOUTH = 'le-24' as CardDefinitionId;             // Man
const ASTERNAK = 'le-1' as CardDefinitionId;               // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;           // Orc → makes the company overt

describe('Edoras (le-372)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Minas Morgul → Edoras (le-372) ──────────────────────────────

  test('starter movement from Minas Morgul reaches minion Edoras (le-372)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterLe372 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EDORAS_LE as string),
    );

    expect(starterLe372).toBeDefined();
  });

  test('starter movement from Minas Morgul does NOT reach hero Edoras (tw-394)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterTw394 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EDORAS_TW as string),
    );

    expect(starterTw394).toBeUndefined();
  });

  test('starter movement from Lórien does NOT reach minion Edoras (le-372)', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterLe372 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EDORAS_LE as string),
    );

    expect(starterLe372).toBeUndefined();
  });

  test('starter movement from Dol Guldur does NOT reach minion Edoras (le-372)', () => {
    // Edoras (le-372) is keyed to Minas Morgul, not Dol Guldur.
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterLe372 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EDORAS_LE as string),
    );

    expect(starterLe372).toBeUndefined();
  });

  // ─── Movement: Edoras (le-372) → Minas Morgul ──────────────────────────────

  test('starter movement from minion Edoras (le-372) reaches Minas Morgul', () => {
    const edoras = pool[EDORAS_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edoras, allSites);
    const starterMinasMorgul = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MINAS_MORGUL as string),
    );

    expect(starterMinasMorgul).toBeDefined();
  });

  // ─── Region movement ───────────────────────────────────────────────────────

  test('region movement from Minas Morgul reaches minion Edoras within 4 regions', () => {
    // Imlad Morgul → Ithilien → Anórien → Rohan = 4 regions, distance 4
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (EDORAS_LE as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(4);
  });

  test('haven-to-haven movement from Minas Morgul does not include Edoras (not a haven)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(minasMorgul.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('Edoras')).toBe(false);
  });

  // ─── Automatic attack: Men, each character faces 1 strike ───────────────────
  // Engine-driven regression for the each-character encoding (strikes: 1 +
  // combatRules ["each-character"]); detainment gated on defender.covert.

  test('each-character: Men attack pre-assigns one strike per character (strikesTotal = company size)', () => {
    const state = setupRingwraithAutoAttack(EDORAS_LE, [THE_MOUTH, ASTERNAK, ORC_CAPTAIN]);

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
    const state = setupRingwraithAutoAttack(EDORAS_LE, [THE_MOUTH, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(true);
  });

  test('overt company: the Men each-character attack is NOT detainment', () => {
    const state = setupRingwraithAutoAttack(EDORAS_LE, [ORC_CAPTAIN, THE_MOUTH]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(false);
  });
});
