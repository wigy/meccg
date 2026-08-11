/**
 * @module le-378.test
 *
 * Card test: Goblin-gate (le-378)
 * Type: minion-site (shadow-hold) in High Pass
 * Effects: 1 (site-rule attacks-not-detainment filtered to non-Nazgûl)
 *
 * Text:
 *   Nearest Darkhaven: Carn Dûm.
 *   Playable: Items (minor, gold ring).
 *   Automatic-attacks: Orcs — 3 strikes with 6 prowess.
 *   Special: Non-Nazgûl creatures played at this site attack normally,
 *     not as detainment.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                                  |
 * |---|-------------------|--------|------------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                                                  |
 * | 2 | sitePath          | OK     | [wilderness, wilderness] — matches card {w}{w}                         |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion haven in card pool (le-359)                  |
 * | 4 | region            | OK     | "High Pass" — valid region in card pool                                |
 * | 5 | playableResources | OK     | [minor, gold-ring] — matches card text                                 |
 * | 6 | automaticAttacks  | OK     | Orcs, 3 strikes, 6 prowess                                             |
 * | 7 | resourceDraws     | OK     | 2                                                                      |
 * | 8 | hazardDraws       | OK     | 2                                                                      |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                                       |
 * |---|---------------------------------|-------------|---------------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources               |
 * | 2 | Haven path movement             | IMPLEMENTED | movement-map.ts resolves nearestHaven ↔ Carn Dûm            |
 * | 3 | Region movement                 | IMPLEMENTED | regional distance from Angmar / Southern Mirkwood           |
 * | 4 | Card draws                      | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase        |
 * | 5 | Automatic attacks at site       | IMPLEMENTED | site-phase auto-attack initiates Orc combat (3/6)           |
 * | 6 | Attacks-not-detainment override | IMPLEMENTED | site-rule overrides CoE §3.II.2.R1 for non-Nazgûl            |
 *
 * Playable: YES
 *
 * Certified: 2026-04-19
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, pool, LORIEN, buildMinionSitePhaseState, setupAutoAttackStep, dispatch, PLAYER_1,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, Alignment, SiteType,
} from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import type { SiteCard } from '../../index.js';
import { Race } from '../../types/common.js';

const GOBLIN_GATE_LE = 'le-378' as CardDefinitionId;
const GOBLIN_GATE_TW = 'tw-398' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const GRISHNAKH = 'le-12' as CardDefinitionId;

describe('Goblin-gate (le-378)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Carn Dûm → Goblin-gate (LE) ─────────────────────────────────

  test('starter movement from Carn Dûm reaches minion Goblin-gate (le-378)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterLe378 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GOBLIN_GATE_LE as string),
    );

    expect(starterLe378).toBeDefined();
  });

  test('starter movement from Carn Dûm does NOT reach hero Goblin-gate (tw-398)', () => {
    // The hero Goblin-gate's nearestHaven is Rivendell, not Carn Dûm.
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterTw398 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GOBLIN_GATE_TW as string),
    );

    expect(starterTw398).toBeUndefined();
  });

  test('starter movement from Dol Guldur does NOT reach minion Goblin-gate (le-378)', () => {
    // le-378's nearestHaven is Carn Dûm, not Dol Guldur.
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterLe378 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GOBLIN_GATE_LE as string),
    );

    expect(starterLe378).toBeUndefined();
  });

  test('starter movement from Lórien does NOT reach minion Goblin-gate (le-378)', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterLe378 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GOBLIN_GATE_LE as string),
    );

    expect(starterLe378).toBeUndefined();
  });

  // ─── Movement: Goblin-gate → Carn Dûm ──────────────────────────────────────

  test('starter movement from minion Goblin-gate (le-378) reaches Carn Dûm', () => {
    const goblinGate = pool[GOBLIN_GATE_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, goblinGate, allSites);
    const starterCarnDum = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CARN_DUM as string),
    );

    expect(starterCarnDum).toBeDefined();
  });

  test('starter movement from minion Goblin-gate (le-378) does NOT reach Dol Guldur', () => {
    const goblinGate = pool[GOBLIN_GATE_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, goblinGate, allSites);
    const starterDolGuldur = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starterDolGuldur).toBeUndefined();
  });

  // ─── Region movement ───────────────────────────────────────────────────────

  test('region movement from Carn Dûm reaches le-378 with distance 3', () => {
    // Carn Dûm is in Angmar; Goblin-gate is in High Pass.
    // Angmar → Rhudaur → High Pass is 2 edges → regionDistance === 3.
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (GOBLIN_GATE_LE as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('region movement from Dol Guldur reaches le-378 within 4 regions', () => {
    // Dol Guldur is in Southern Mirkwood; Goblin-gate is in High Pass.
    // Southern Mirkwood → Anduin Vales → High Pass is 2 edges → regionDistance === 3.
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (GOBLIN_GATE_LE as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('haven-to-haven movement from Carn Dûm does not include le-378 (not a haven)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(carnDum.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('Goblin-gate')).toBe(false);
  });

  // ─── attacks-not-detainment: direct detainment helper tests ─────────────────

  test('non-Nazgûl creature keyed to Shadow-hold at Goblin-gate: detainment overridden to false', () => {
    // CoE §3.II.2.R1 would normally flag this as detainment (Ringwraith
    // defender, Orc keyed to Shadow-hold). Goblin-gate's site rule overrides it.
    const goblinGateDef = pool[GOBLIN_GATE_LE as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: goblinGateDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('Nazgûl creature at Goblin-gate: override filter skips it, detainment preserved', () => {
    // Filter is `{ enemy.race: { $ne: nazgul } }`. A Nazgûl attack does NOT
    // match the filter, so the override does not fire. The attack is still
    // detainment via R1 (keyed to Shadow-hold).
    const goblinGateDef = pool[GOBLIN_GATE_LE as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'ringwraith' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: goblinGateDef.effects,
    });
    expect(detainment).toBe(true);
  });

  // ─── attacks-not-detainment: integration via reducer ───────────────────────

  test('site automatic-attack (Orc, 3 strikes/6 prowess) at Goblin-gate is not detainment', () => {
    // Reproduces the reported game (msotr1yy-z2yrcq, stateSeq 171): a
    // Ringwraith-aligned company at Goblin-gate faces the site's own
    // automatic-attack. combat.detainment must be false per the card text,
    // not true as the engine previously computed via CoE §3.II.2.R1
    // (Ringwraith defender + attack keyed to Shadow-hold).
    const state = buildMinionSitePhaseState({ site: GOBLIN_GATE_LE, characters: [GRISHNAKH] });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(6);
    expect(next.combat!.creatureRace).toBe('orc');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
    expect(next.combat!.detainment).toBe(false);
  });
});
