/**
 * @module as-139.test
 *
 * Card test: Gobel Mírlond (as-139)
 * Type: hero-site (border-hold) in Harondor
 * Effects: 1 — combat-detainment (automatic attack is detainment)
 *
 * Text:
 *   Nearest Haven: Edhellond
 *   Playable: Items (minor, major)
 *   Automatic-attacks: Men — 4 strikes with 9 prowess (detainment)
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                               |
 * |---|-------------------|--------|-----------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                               |
 * | 2 | sitePath          | OK     | [wilderness, free, coastal, wilderness]             |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid hero haven (tw-393)             |
 * | 4 | region            | OK     | "Harondor"                                          |
 * | 5 | playableResources | OK     | [minor, major] — matches text                       |
 * | 6 | automaticAttacks  | OK     | Men, 4 strikes / 9 prowess                          |
 * | 7 | effects           | OK     | combat-detainment — auto-attack is detainment       |
 * | 8 | resourceDraws     | OK     | 2                                                   |
 * | 9 | hazardDraws       | OK     | 2                                                   |
 *
 * Engine Support:
 * | # | Feature                    | Status      | Notes                                          |
 * |---|----------------------------|-------------|------------------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED | select-company, enter-or-skip, play-resources  |
 * | 2 | Automatic attack           | IMPLEMENTED | Men 4/9 triggers combat via pass               |
 * | 3 | Detainment (combat-detainment effect) | IMPLEMENTED | isDetainmentAttack() reads siteDef.effects |
 * | 4 | Item playability           | IMPLEMENTED | playableResources gate                         |
 * | 5 | Haven path movement        | IMPLEMENTED | Edhellond (tw-393) ↔ Gobel Mírlond             |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  EDHELLOND,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  viableActions,
  dispatch,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const GOBEL_MIRLOND = 'as-139' as CardDefinitionId;
const DAGGER_OF_WESTERNESSE = 'tw-206' as CardDefinitionId;

describe('Gobel Mírlond (as-139)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Men 4/9, detainment ──────────────────────────────────

  test('automatic attack: Men — 4 strikes with 9 prowess', () => {
    const state = buildSitePhaseState({
      site: GOBEL_MIRLOND,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(9);
    expect(next.combat!.creatureRace).toBe('man');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  test('automatic attack is detainment', () => {
    const state = buildSitePhaseState({
      site: GOBEL_MIRLOND,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.detainment).toBe(true);
  });

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at Gobel Mírlond', () => {
    const state = buildSitePhaseState({
      site: GOBEL_MIRLOND,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ─── Movement: Edhellond ↔ Gobel Mírlond ────────────────────────────────────

  test('starter movement from Edhellond reaches Gobel Mírlond', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GOBEL_MIRLOND as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Gobel Mírlond reaches Edhellond', () => {
    const gobelMirlond = pool[GOBEL_MIRLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, gobelMirlond, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EDHELLOND as string),
    );

    expect(starter).toBeDefined();
  });
});
