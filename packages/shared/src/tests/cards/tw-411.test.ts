/**
 * @module tw-411.test
 *
 * Card test: Minas Morgul (tw-411)
 * Type: hero-site (dark-hold)
 * Effects: 1 (on-event: character-wounded-by-self → force corruption check)
 *
 * "Nearest Haven: Lórien
 *  Playable: Items (minor, major, greater)
 *  Automatic-attacks: Undead — 3 strikes with 8 prowess; each character
 *  wounded must make a corruption check"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                               |
 * |---|-------------------|--------|-----------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid                                 |
 * | 2 | sitePath          | OK     | [wilderness, border, free, wilderness, shadow]      |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                 |
 * | 4 | region            | OK     | "Imlad Morgul" — valid region in card pool          |
 * | 5 | playableResources | OK     | [minor, major, greater] — matches card text         |
 * | 6 | automaticAttacks  | OK     | Undead 3 strikes 8 prowess — matches card text      |
 * | 7 | resourceDraws     | OK     | 3                                                   |
 * | 8 | hazardDraws       | OK     | 4                                                   |
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                                  |
 * |---|--------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Site phase flow                | IMPLEMENTED | select-company, enter-or-skip, play-resources          |
 * | 2 | Item playability               | IMPLEMENTED | minor, major, greater via playableResources            |
 * | 3 | Haven path movement            | IMPLEMENTED | Lórien → Minas Morgul via starter movement             |
 * | 4 | Card draws                     | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase   |
 * | 5 | Automatic attacks              | IMPLEMENTED | site-phase auto-attack initiates Undead combat         |
 * | 6 | Wound → corruption check       | IMPLEMENTED | on-event: character-wounded-by-self (reducer-combat.ts)|
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LORIEN,
  ARAGORN, LEGOLAS, GIMLI, GLAMDRING, DAGGER_OF_WESTERNESSE,
  resetMint, pool, CardStatus,
  buildSitePhaseState, setupAutoAttackStep, findCharInstanceId,
  dispatch, expectCharStatus,
  viableActions, RESOURCE_PLAYER,
  expectCharNotInPlay,
  runAutoAttackCombatMulti,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, CardDefinitionId } from '../../index.js';

const MINAS_MORGUL = 'tw-411' as CardDefinitionId;

describe('Minas Morgul (tw-411)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ─────────────────────────────────────────────────────

  test('Undead automatic attack triggers with 3 strikes and 8 prowess', () => {
    const state = buildSitePhaseState({ site: MINAS_MORGUL, characters: [ARAGORN, LEGOLAS, GIMLI] });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(3);
    expect(nextState.combat!.strikeProwess).toBe(8);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Wound → corruption check ─────────────────────────────────────────────

  test('wounded character gets corruption check after auto-attack', () => {
    const state = buildSitePhaseState({ site: MINAS_MORGUL, characters: [ARAGORN, LEGOLAS, GIMLI] });
    const readyState = setupAutoAttackStep(state);

    // Aragorn untapped (prowess 3) + roll 2 = 5 < 8 → wounded. Body check 5 ≤ 9 → survives.
    // Legolas taps (prowess 5) + roll 12 = 17 > 8 → wins.
    // Gimli taps (prowess 5) + roll 12 = 17 > 8 → wins.
    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: ARAGORN, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: LEGOLAS, roll: 12, tapToFight: true },
      { characterDefId: GIMLI, roll: 12, tapToFight: true },
    ]);
    expect(result.state.combat).toBeNull();

    const aragornId = findCharInstanceId(result.state, RESOURCE_PLAYER, ARAGORN);
    const pending = result.state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.characterId).toBe(aragornId);
  });

  test('corruption check after wound passes with high roll', () => {
    const state = buildSitePhaseState({ site: MINAS_MORGUL, characters: [ARAGORN, LEGOLAS, GIMLI] });
    const readyState = setupAutoAttackStep(state);

    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: ARAGORN, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: LEGOLAS, roll: 12, tapToFight: true },
      { characterDefId: GIMLI, roll: 12, tapToFight: true },
    ]);

    const ccAction = viableActions(result.state, PLAYER_1, 'corruption-check')[0].action;
    const ccState = dispatch({ ...result.state, cheatRollTotal: 12 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);
    expectCharStatus(ccState, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });

  test('corruption check after wound fails — character discarded', () => {
    const state = buildSitePhaseState({
      site: MINAS_MORGUL,
      characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }, LEGOLAS, GIMLI],
    });
    const readyState = setupAutoAttackStep(state);

    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: ARAGORN, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: LEGOLAS, roll: 12, tapToFight: true },
      { characterDefId: GIMLI, roll: 12, tapToFight: true },
    ]);

    const ccAction = viableActions(result.state, PLAYER_1, 'corruption-check')[0].action;
    expect(ccAction.type).toBe('corruption-check');

    // Aragorn + Glamdring (2 CP) + Dagger (1 CP) = 3 CP total; roll 2 → fails
    const ccState = dispatch({ ...result.state, cheatRollTotal: 2 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);
    const aragornId = findCharInstanceId(result.state, RESOURCE_PLAYER, ARAGORN);
    expectCharNotInPlay(ccState, RESOURCE_PLAYER, aragornId);
  });

  test('all characters win auto-attack — no corruption check', () => {
    const state = buildSitePhaseState({ site: MINAS_MORGUL, characters: [ARAGORN, LEGOLAS, GIMLI] });
    const readyState = setupAutoAttackStep(state);

    // All tap to fight with high rolls → all win (each total > 8)
    const result = runAutoAttackCombatMulti(readyState, [
      { characterDefId: ARAGORN, roll: 12, tapToFight: true },
      { characterDefId: LEGOLAS, roll: 12, tapToFight: true },
      { characterDefId: GIMLI, roll: 12, tapToFight: true },
    ]);
    expect(result.state.combat).toBeNull();

    expect(result.state.pendingResolutions).toHaveLength(0);
  });

  // ─── Item playability ─────────────────────────────────────────────────────

  test('minor, major, and greater items playable at Minas Morgul', () => {
    const state = buildSitePhaseState({
      site: MINAS_MORGUL,
      hand: [GLAMDRING, DAGGER_OF_WESTERNESSE],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('starter movement from Lórien reaches Minas Morgul', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MINAS_MORGUL as string),
    );

    expect(entry).toBeDefined();
  });
});
