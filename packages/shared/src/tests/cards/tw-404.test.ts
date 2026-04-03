/**
 * @module tw-404.test
 *
 * Card test: Isengard (tw-404)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Haven: Lórien. Playable: Items (minor, major, gold ring).
 *  Automatic-attacks: Wolves — 3 strikes with 7 prowess."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                  |
 * | 2 | sitePath          | OK     | [wilderness, border, border] — Wold & Foothills→Rohan→Gap  |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                        |
 * | 4 | playableResources | OK     | [minor, major, gold-ring] — matches card text              |
 * | 5 | automaticAttacks  | OK     | Wolves, 3 strikes, 7 prowess — matches card text           |
 * | 6 | resourceDraws     | OK     | 2                                                          |
 * | 7 | hazardDraws       | OK     | 2                                                          |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability        | IMPLEMENTED | minor, major, gold-ring checked     |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 5 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 6 | Automatic attacks       | IMPLEMENTED | combat initiated with correct stats  |
 *
 * Playable: YES
 * Certified: 2026-04-02
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LORIEN,
  resetMint, pool, reduce,
  buildSitePhaseState,
} from '../test-helpers.js';
import {
  computeLegalActions,
  ISENGARD, GLAMDRING, DAGGER_OF_WESTERNESSE,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, SitePhaseState } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Isengard (tw-404)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('is a ruins-and-lairs with correct structural properties', () => {
    const def = pool[ISENGARD as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('ruins-and-lairs');
    expect(def.sitePath).toEqual(['wilderness', 'border', 'border']);
    expect(def.nearestHaven).toBe('Lórien');
    expect(def.region).toBe('Gap of Isen');
    expect(def.playableResources).toEqual(['minor', 'major', 'gold-ring']);
    expect(def.resourceDraws).toBe(2);
    expect(def.hazardDraws).toBe(2);
  });

  test('nearest haven Lórien exists in the card pool', () => {
    const lorienDef = pool[LORIEN as string];
    expect(lorienDef).toBeDefined();
    expect(isSiteCard(lorienDef)).toBe(true);
    if (!isSiteCard(lorienDef)) return;
    expect(lorienDef.siteType).toBe('haven');
  });

  test('automatic attack matches card text', () => {
    const def = pool[ISENGARD as string];
    if (!isSiteCard(def)) return;

    expect(def.automaticAttacks).toHaveLength(1);
    expect(def.automaticAttacks[0]).toEqual({
      creatureType: 'Wolves',
      strikes: 3,
      prowess: 7,
    });
  });

  test('site path regions are valid types', () => {
    const def = pool[ISENGARD as string];
    if (!isSiteCard(def)) return;

    const validTypes = new Set([
      'wilderness', 'border', 'free', 'coastal', 'shadow',
      'dark', 'double-wilderness', 'double-shadow-land', 'double-coastal-sea',
    ]);
    for (const region of def.sitePath) {
      expect(validTypes.has(region)).toBe(true);
    }
  });

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Isengard', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    // Should have play-hero-resource for the minor item + pass
    const playActions = viable.filter(a => a.action.type === 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Isengard', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      hand: [GLAMDRING],
    });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    const playActions = viable.filter(a => a.action.type === 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are not playable at Isengard', () => {
    const def = pool[ISENGARD as string];
    if (!isSiteCard(def)) return;

    // Isengard allows minor, major, gold-ring but NOT greater
    expect(def.playableResources).not.toContain('greater');
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: ISENGARD });
    const actions = computeLegalActions(state, PLAYER_1);

    const passActions = actions.filter(a => a.viable && a.action.type === 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Isengard ─────────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Isengard');
  });

  test('reachable from Lórien via region movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Isengard',
    );

    expect(regionEntry).toBeDefined();
    // Wold & Foothills → Rohan → Gap of Isen = 3 regions traversed
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('not reachable from Grey Havens via starter movement', () => {
    // Isengard's nearest haven is Lórien, not Grey Havens
    const allSites = Object.values(pool).filter(isSiteCard);
    const greyHavens = allSites.find(s => s.name === 'Grey Havens')!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Isengard');
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Wolves automatic attack triggers with 3 strikes and 7 prowess', () => {
    // Build a state at the automatic-attacks step with a company at Isengard.
    const state = buildSitePhaseState({ site: ISENGARD });
    const autoAttackState: SitePhaseState = {
      ...state.phaseState,
      step: 'automatic-attacks',
      siteEntered: false,
      automaticAttacksResolved: 0,
    };
    const readyState = { ...state, phaseState: autoAttackState };

    // Active player passes to trigger the automatic attack combat.
    const result = reduce(readyState, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(3);
    expect(result.state.combat!.strikeProwess).toBe(7);
    expect(result.state.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── No special effects ───────────────────────────────────────────────────

  test('has no special effects beyond standard site properties', () => {
    // Isengard's card text describes only standard site properties:
    // nearest haven, playable resources, and automatic attacks.
    // These are all encoded in the site's structural fields, not as effects.
    // Verify the card text matches what the structural fields encode.
    const def = pool[ISENGARD as string];
    if (!isSiteCard(def)) return;

    expect(def.text).toContain('Nearest Haven: Lórien');
    expect(def.text).toContain('Items (minor, major, gold ring)');
    expect(def.text).toContain('Wolves');
    expect(def.text).toContain('3 strikes with 7 prowess');
  });
});
