/**
 * @module dm-32.test
 *
 * Card test: Hermit's Hill (dm-32)
 * Type: hero-site (ruins-and-lairs) in Wold & Foothills
 * Effects: 1 — grant-action (discard-minors-for-major, NOT IMPLEMENTED)
 *
 * Text:
 *   Nearest Haven: Lórien
 *   Playable: Items (minor)
 *   Automatic-attacks: Men — 3 strikes with 6 prowess
 *   Special: During the site phase, a company may discard two minor items they
 *     bear to make any one major item (including a hoard item) playable at this
 *     untapped site this turn.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                               |
 * |---|-------------------|--------|-----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                           |
 * | 2 | sitePath          | OK     | ["wilderness"] — matches single-wilderness path     |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid hero haven (tw-408)                |
 * | 4 | region            | OK     | "Wold & Foothills"                                  |
 * | 5 | playableResources | OK     | ["minor"] — matches text                            |
 * | 6 | automaticAttacks  | OK     | Men, 3 strikes / 6 prowess                          |
 * | 7 | resourceDraws     | OK     | 1                                                   |
 * | 8 | hazardDraws       | OK     | 1                                                   |
 * | 9 | effects           | DATA   | grant-action "discard-minors-for-major" in effects  |
 *
 * Engine Support:
 * | # | Feature                       | Status          | Notes                                        |
 * |---|-------------------------------|-----------------|----------------------------------------------|
 * | 1 | Site phase flow               | IMPLEMENTED     | select-company, enter-or-skip, play-resources |
 * | 2 | Automatic attack (Men 3/6)    | IMPLEMENTED     | passes through as data                       |
 * | 3 | Minor item playability        | IMPLEMENTED     | playableResources gate                       |
 * | 4 | Major item NOT playable       | IMPLEMENTED     | not in playableResources                     |
 * | 5 | Haven path movement           | IMPLEMENTED     | movement-map.ts — Lórien ↔ Hermit's Hill     |
 * | 6 | grant-action discard-minors-  | NOT IMPLEMENTED | no engine support for this action type       |
 *         for-major                |                 |                                              |
 *
 * Playable: PARTIALLY
 * NOT CERTIFIED — grant-action "discard-minors-for-major" (special site ability
 *   to unlock major items by discarding two minor items) has no engine support.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, ARAGORN,
  LORIEN, GLAMDRING, DAGGER_OF_WESTERNESSE,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  viableActions, dispatch,
} from '../test-helpers.js';
import {
  isSiteCard,
  buildMovementMap,
  getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const HERMITS_HILL = 'dm-32' as CardDefinitionId;

describe("Hermit's Hill (dm-32)", () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Men 3/6 ───────────────────────────────────────────────

  test('automatic attack: Men — 3 strikes with 6 prowess', () => {
    const state = buildSitePhaseState({
      site: HERMITS_HILL,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(6);
    expect(next.combat!.creatureRace).toBe('man');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at Hermit\'s Hill', () => {
    const state = buildSitePhaseState({
      site: HERMITS_HILL,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is NOT playable at Hermit\'s Hill without the special ability', () => {
    const state = buildSitePhaseState({
      site: HERMITS_HILL,
      hand: [GLAMDRING],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });

  // ─── Movement: Lórien ↔ Hermit's Hill ────────────────────────────────────────

  test("starter movement from Lórien reaches Hermit's Hill", () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (HERMITS_HILL as string),
    );

    expect(starter).toBeDefined();
  });

  test("starter movement from Hermit's Hill reaches Lórien", () => {
    const hermitsHill = pool[HERMITS_HILL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, hermitsHill, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LORIEN as string),
    );

    expect(starter).toBeDefined();
  });
});
