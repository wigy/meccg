/**
 * @module le-378.test
 *
 * Card test: Goblin-gate (le-378)
 * Type: minion-site (shadow-hold) in High Pass
 * Effects: 0 (special rule defers to an unimplemented engine mechanic)
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
 * | 6 | automaticAttacks  | OK     | Orcs, 3 strikes, 6 prowess — data only (auto-attack combat stubbed)    |
 * | 7 | resourceDraws     | OK     | 2                                                                      |
 * | 8 | hazardDraws       | OK     | 2                                                                      |
 *
 * Engine Support:
 * | # | Feature                         | Status          | Notes                                                       |
 * |---|---------------------------------|-----------------|-------------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED     | select-company, enter-or-skip, play-resources               |
 * | 2 | Haven path movement             | IMPLEMENTED     | movement-map.ts resolves nearestHaven ↔ Carn Dûm            |
 * | 3 | Region movement                 | IMPLEMENTED     | regional distance from Angmar / Southern Mirkwood           |
 * | 4 | Card draws                      | IMPLEMENTED     | resourceDraws / hazardDraws thread through M/H phase        |
 * | 5 | Automatic attacks at site       | NOT IMPLEMENTED | auto-attack trigger is stubbed; data-only for now           |
 * | 6 | Non-Nazgûl "attack normally"    | NOT APPLICABLE  | site-specific exception to minion detainment (rule 8.33),   |
 * |   | exception to detainment         |                 | which is itself unimplemented (CombatState.detainment is    |
 * |   |                                 |                 | never set to true). Defer until rule 8.33 lands.            |
 *
 * Playable: YES — no DSL effects are required for the current engine.
 *   The special rule carves out an exception to rule 8.33 (minion/balrog
 *   detainment), a mechanic that has not yet been wired in. When minion
 *   detainment is implemented, revisit this card.
 *
 * Certified: 2026-04-19
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { resetMint, pool, LORIEN } from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

const GOBLIN_GATE_LE = 'le-378' as CardDefinitionId;
const GOBLIN_GATE_TW = 'tw-398' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

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
});
