/**
 * @module le-369.test
 *
 * Card test: Dunharrow (le-369)
 * Type: minion-site (border-hold) in Rohan
 * Effects: 1 — combat-detainment gated on defender.covert
 *
 * Text:
 *   Nearest Darkhaven: Minas Morgul
 *   Playable: Information
 *   Automatic-attacks: Men — each character faces 1 strike with 6 prowess
 *     (detainment against covert company)
 *
 * Data fix this pass: the imported `playableResources` and `automaticAttacks`
 * were both empty, contradicting the printed "Playable: Information" and
 * "Automatic-attacks: Men …" lines (same import bug as Vale of Erech le-410 /
 * Stone-circle le-405). Now `playableResources: ["information"]`, the Men
 * each-character auto-attack, the `combat-detainment` effect (gated on
 * `defender.covert`), and the `unique` flag are set — matching the certified
 * border-hold twin Vale of Erech (le-410), which shares the identical Minas
 * Morgul haven and Men detainment-vs-covert attack (7 prowess there, 6 here).
 * The "Playable: Information" gate mirrors The Worthy Hills (as-142).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid ({B})                        |
 * | 2 | sitePath          | OK     | [shadow, wilderness, free, shadow] — {s}{w}{f}{s}  |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion haven (le-390)       |
 * | 4 | region            | OK     | "Rohan"                                            |
 * | 5 | playableResources | OK     | ["information"] — matches card text (data fix)     |
 * | 6 | automaticAttacks  | OK     | Men, prowess 6, each-character / detainment-vs-covert |
 * | 7 | resourceDraws     | OK     | 2                                                  |
 * | 8 | hazardDraws       | OK     | 2                                                  |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                              |
 * |---|---------------------------------|-------------|----------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources      |
 * | 2 | Information playability gate     | IMPLEMENTED | playableResources gates non-information items      |
 * | 3 | Haven path movement             | IMPLEMENTED | movement-map.ts resolves the Minas Morgul link     |
 * | 4 | Automatic attack combat         | IMPLEMENTED | each-character: one strike per character; detainment |
 * |   |                                 |             | gated on defender.covert (combat-detainment effect) |
 *
 * Playable: YES
 * Certified: 2026-07-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool,
  buildMinionSitePhaseState, setupRingwraithAutoAttack,
  viableActions,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import { reduce } from '../../engine/reducer.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const DUNHARROW = 'le-369' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

// Minion character for the item-playability fixture
const GORBAG = 'le-11' as CardDefinitionId;

// A minor minion item — NOT information, so the "Playable: Information" gate blocks it.
const POISON = 'le-338' as CardDefinitionId;

// Each-character auto-attack fixture: Men keep a Ringwraith company covert; an
// Orc makes it overt (toggling the detainment-vs-covert effect).
const THE_MOUTH = 'le-24' as CardDefinitionId;           // Man
const ASTERNAK = 'le-1' as CardDefinitionId;             // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;         // Orc → makes the company overt

describe('Dunharrow (le-369)', () => {
  beforeEach(() => resetMint());

  // ─── Playable: Information — non-information items are not offered ────────────

  test('minor item (Poison) is NOT viable at Dunharrow (only information is playable)', () => {
    // Dunharrow lists only "information" in playableResources; a minor item's
    // subtype is not in the site's playable set, so no play action is offered.
    const state = buildMinionSitePhaseState({
      site: DUNHARROW,
      characters: [GORBAG],
      hand: [POISON],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  // ─── Automatic attack: Men, each character faces 1 strike with 6 prowess ─────

  test('each-character: Men attack pre-assigns one strike per character (strikesTotal = company size)', () => {
    const state = setupRingwraithAutoAttack(DUNHARROW, [THE_MOUTH, ASTERNAK, ORC_CAPTAIN]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.strikeProwess).toBe(6);
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.eachCharacterFacesOneStrike).toBe(true);
    // Assignment is automatic — combat does not stall in `assign-strikes`.
    expect(after.combat!.phase).not.toBe('assign-strikes');
    expect(after.combat!.assignmentPhase).toBe('done');
  });

  test('covert company: the Men each-character attack is detainment', () => {
    // An all-Men Ringwraith company is covert; the combat-detainment effect
    // (gated on defender.covert) makes the attack detainment.
    const state = setupRingwraithAutoAttack(DUNHARROW, [THE_MOUTH, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(true);
  });

  test('overt company: the Men each-character attack is NOT detainment', () => {
    // An Orc makes the company overt; the detainment guard no longer fires.
    const state = setupRingwraithAutoAttack(DUNHARROW, [ORC_CAPTAIN, THE_MOUTH]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(false);
  });

  // ─── Movement: Minas Morgul ↔ Dunharrow ─────────────────────────────────────

  test('starter movement from Minas Morgul reaches Dunharrow (le-369)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DUNHARROW as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Dunharrow returns to Minas Morgul', () => {
    const dunharrow = pool[DUNHARROW as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dunharrow, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MINAS_MORGUL as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Dol Guldur does NOT reach Dunharrow (wrong haven)', () => {
    // Dunharrow's nearestHaven is Minas Morgul, not Dol Guldur.
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DUNHARROW as string),
    );

    expect(starter).toBeUndefined();
  });
});
