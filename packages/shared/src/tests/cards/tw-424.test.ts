/**
 * @module tw-424.test
 *
 * Card test: Shelob's Lair (tw-424)
 * Type: hero-site (shadow-hold)
 * Effects: 0
 *
 * "Nearest Haven: Lórien
 *  Playable: Items (minor, major)
 *  Automatic-attacks: Orcs — 2 strikes with 8 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                    |
 * |---|-------------------|--------|----------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                                   |
 * | 2 | sitePath          | OK     | [wilderness, border, free, wilderness, shadow]           |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                    |
 * | 4 | region            | OK     | "Imlad Morgul" — valid region                           |
 * | 5 | playableResources | OK     | ["minor", "major"] — matches card text                  |
 * | 6 | automaticAttacks  | OK     | Orcs 2 strikes 8 prowess — matches card text            |
 * | 7 | resourceDraws     | OK     | 3                                                       |
 * | 8 | hazardDraws       | OK     | 4                                                       |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                                       |
 * |---|---------------------|-------------|---------------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, play-res     |
 * | 2 | Item playability    | IMPLEMENTED | minor, major via playableResources          |
 * | 3 | Auto-attack         | IMPLEMENTED | Orcs 2 strikes 8 prowess                   |
 * | 4 | Starter movement    | IMPLEMENTED | reachable from Lórien (nearestHaven match) |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  dispatch, viableActions, viableFor,
  ARAGORN, LEGOLAS, GIMLI,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  runAutoAttackCombatMulti,
} from '../test-helpers.js';
import {
  LORIEN,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const SHELOBS_LAIR = 'tw-424' as CardDefinitionId;

describe("Shelob's Lair (tw-424)", () => {
  beforeEach(() => resetMint());

  // ─── Item playability ─────────────────────────────────────────────────────

  test('minor items (Dagger of Westernesse) are playable at Shelob\'s Lair', () => {
    const state = buildSitePhaseState({
      site: SHELOBS_LAIR,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items (Glamdring) are playable at Shelob\'s Lair', () => {
    const state = buildSitePhaseState({
      site: SHELOBS_LAIR,
      hand: [GLAMDRING],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('no resources playable when hand is empty — only pass available', () => {
    const state = buildSitePhaseState({ site: SHELOBS_LAIR });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Automatic attack ─────────────────────────────────────────────────────

  test('Orcs automatic attack triggers with 2 strikes and 8 prowess', () => {
    const state = buildSitePhaseState({
      site: SHELOBS_LAIR,
      characters: [ARAGORN, LEGOLAS, GIMLI],
    });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(2);
    expect(nextState.combat!.strikeProwess).toBe(8);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  test('all characters win auto-attack — no pending resolutions', () => {
    const state = buildSitePhaseState({
      site: SHELOBS_LAIR,
      characters: [ARAGORN, LEGOLAS, GIMLI],
    });
    const readyState = setupAutoAttackStep(state);

    // 2 strikes: ARAGORN and LEGOLAS each tap with roll 12 → total > 8 → win
    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: ARAGORN, roll: 12, tapToFight: true },
      { characterDefId: LEGOLAS, roll: 12, tapToFight: true },
    ]);

    expect(result.state.combat).toBeNull();
    expect(result.state.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test("starter movement from Lórien reaches Shelob's Lair", () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (SHELOBS_LAIR as string),
    );

    expect(entry).toBeDefined();
  });
});
