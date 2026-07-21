/**
 * @module le-410.test
 *
 * Card test: Vale of Erech (le-410)
 * Type: minion-site (border-hold) in Lamedon
 * Effects: 1 — combat-detainment gated on defender.covert
 *
 * Text:
 *   Nearest Darkhaven: Minas Morgul
 *   Playable: Items (gold ring)
 *   Automatic-attacks: Men — each character faces 1 strike with 7 prowess
 *     (detainment against covert company)
 *
 * Data fix this pass: the imported `playableResources` and `automaticAttacks`
 * were both empty, contradicting the printed "Playable: Items (gold ring)" and
 * "Automatic-attacks: Men …" lines (same import bug as Stone-circle le-405 /
 * Tharbad le-407). Now `playableResources: ["gold-ring"]`, the Men each-character
 * auto-attack, the `combat-detainment` effect, and the `unique` flag are set —
 * matching the certified border-hold twins Southron Oasis (le-404) and
 * Variag Camp (le-411), which carry the identical Men detainment-vs-covert attack.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid ({B})                        |
 * | 2 | sitePath          | OK     | [shadow, wilderness, free, free, shadow] — {s}{w}{f}{f}{s} |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion haven (le-390)       |
 * | 4 | region            | OK     | "Lamedon"                                          |
 * | 5 | playableResources | OK     | ["gold-ring"] — matches card text (data fix)       |
 * | 6 | automaticAttacks  | OK     | Men, prowess 7, each-character / detainment-vs-covert |
 * | 7 | resourceDraws     | OK     | 2                                                  |
 * | 8 | hazardDraws       | OK     | 3                                                  |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                              |
 * |---|---------------------------------|-------------|----------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources      |
 * | 2 | Gold-ring item playability      | IMPLEMENTED | playableResources gates subtype at site (site.ts)  |
 * | 3 | Haven path movement             | IMPLEMENTED | movement-map.ts resolves the Minas Morgul link     |
 * | 4 | Automatic attack combat         | IMPLEMENTED | each-character: one strike per character; detainment |
 * |   |                                 |             | gated on defender.covert (combat-detainment effect) |
 *
 * Note: "Vale of Erech" is a duplicate site name shared with the hero site
 * tw-434 (nearest haven Edhellond, no auto-attack). Movement assertions
 * therefore key on the site's definition id (le-410).
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

const VALE_OF_ERECH = 'le-410' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

// Minion character for the item-playability fixture
const GORBAG = 'le-11' as CardDefinitionId;

// Items: a border-hold gold-ring item is playable here; a minor item is not.
const GLEAMING_GOLD_RING = 'le-311' as CardDefinitionId; // gold-ring, playable at a Border-hold
const POISON = 'le-338' as CardDefinitionId;             // minor item

// Each-character auto-attack fixture: Men keep a Ringwraith company covert; an
// Orc makes it overt (toggling the detainment-vs-covert effect).
const THE_MOUTH = 'le-24' as CardDefinitionId;           // Man
const ASTERNAK = 'le-1' as CardDefinitionId;             // Man
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;         // Orc → makes the company overt

describe('Vale of Erech (le-410)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability: gold ring only ───────────────────────────────────────

  test('gold-ring item (Gleaming Gold Ring) IS viable at Vale of Erech', () => {
    // Vale of Erech lists only gold-ring items as playable. Gleaming Gold Ring's
    // own item-play-site restriction (a Border-hold where gold rings are playable)
    // is also satisfied — Vale of Erech is a border-hold with gold-ring listed.
    const state = buildMinionSitePhaseState({
      site: VALE_OF_ERECH,
      characters: [GORBAG],
      hand: [GLEAMING_GOLD_RING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('minor item (Poison) is NOT viable at Vale of Erech (only gold-ring listed)', () => {
    // The site's playableResources gate lists only "gold-ring"; a minor item is
    // blocked because its subtype is not in the site's playable set.
    const state = buildMinionSitePhaseState({
      site: VALE_OF_ERECH,
      characters: [GORBAG],
      hand: [POISON],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  // ─── Automatic attack: Men, each character faces 1 strike with 7 prowess ─────

  test('each-character: Men attack pre-assigns one strike per character (strikesTotal = company size)', () => {
    const state = setupRingwraithAutoAttack(VALE_OF_ERECH, [THE_MOUTH, ASTERNAK, ORC_CAPTAIN]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.strikeProwess).toBe(7);
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.eachCharacterFacesOneStrike).toBe(true);
    // Assignment is automatic — combat does not stall in `assign-strikes`.
    expect(after.combat!.phase).not.toBe('assign-strikes');
    expect(after.combat!.assignmentPhase).toBe('done');
  });

  test('covert company: the Men each-character attack is detainment', () => {
    // An all-Men Ringwraith company is covert; the combat-detainment effect
    // (gated on defender.covert) makes the attack detainment.
    const state = setupRingwraithAutoAttack(VALE_OF_ERECH, [THE_MOUTH, ASTERNAK]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(true);
  });

  test('overt company: the Men each-character attack is NOT detainment', () => {
    // An Orc makes the company overt; the detainment guard no longer fires.
    const state = setupRingwraithAutoAttack(VALE_OF_ERECH, [ORC_CAPTAIN, THE_MOUTH]);

    const { state: after, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.detainment).toBe(false);
  });

  // ─── Movement: Minas Morgul ↔ Vale of Erech ─────────────────────────────────

  test('starter movement from Minas Morgul reaches Vale of Erech (le-410)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (VALE_OF_ERECH as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Vale of Erech returns to Minas Morgul', () => {
    const valeOfErech = pool[VALE_OF_ERECH as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, valeOfErech, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MINAS_MORGUL as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Dol Guldur does NOT reach Vale of Erech (wrong haven)', () => {
    // Vale of Erech's nearestHaven is Minas Morgul, not Dol Guldur.
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (VALE_OF_ERECH as string),
    );

    expect(starter).toBeUndefined();
  });
});
