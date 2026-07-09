/**
 * @module le-353.test
 *
 * Card test: Barrow-downs (le-353)
 * Type: minion-site (ruins-and-lairs)
 * Effects: 1 (on-event: character-wounded-by-self → force corruption check, modifier -2)
 *
 * "Nearest Darkhaven: Carn Dûm
 *  Playable: Items (minor, major)
 *  Automatic-attacks: Undead — 1 strike with 8 prowess;
 *  each character wounded must make a corruption check modified by -2."
 *
 * This is the minion (LE) counterpart of the hero Barrow-downs (tw-375). The
 * only mechanical difference is the corruption check is modified by -2 (the
 * hero version has no modifier). Both share the certified engine machinery:
 * a site automatic-attack resolves its `on-event: character-wounded-by-self`
 * effect in combat-finalize.ts, enqueuing a corruption check per wounded
 * character.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                             |
 * |---|-------------------|--------|---------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                         |
 * | 2 | sitePath          | OK     | [shadow, wilderness, wilderness] — matches {s}{w}{w} |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion haven (le-359)          |
 * | 4 | region            | OK     | "Cardolan"                                        |
 * | 5 | playableResources | OK     | [minor, major] — matches card text                |
 * | 6 | automaticAttacks  | OK     | Undead, 1 strike, 8 prowess                       |
 * | 7 | resourceDraws     | OK     | 2                                                 |
 * | 8 | hazardDraws       | OK     | 2                                                 |
 *
 * Engine Support:
 * | # | Feature                       | Status      | Notes                              |
 * |---|-------------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow               | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability              | IMPLEMENTED | minor, major playable; greater not  |
 * | 3 | Haven path movement           | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Automatic attacks             | IMPLEMENTED | combat initiated with correct stats  |
 * | 5 | Wound → corruption check (-2) | IMPLEMENTED | on-event: character-wounded-by-self  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  resetMint, pool, CardStatus,
  buildMinionSitePhaseState, setupAutoAttackStep,
  runAutoAttackCombat, findCharInstanceId, findHandCardId,
  dispatch, expectCharStatus, expectCharNotInPlay,
  viableFor, viableActions,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const BARROW_DOWNS = 'le-353' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

// The Mouth: Man, prowess 6. Untapped he fights at prowess 3, so a low strike
// roll wounds him; tapped-to-fight at prowess 6 a high roll wins.
const THE_MOUTH = 'le-24' as CardDefinitionId;
const BLACK_MACE = 'le-299' as CardDefinitionId;         // greater item, 3 CP
const HIGH_HELM = 'le-313' as CardDefinitionId;          // major item, 2 CP
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;  // minor item, 1 CP
const IRON_CROWN = 'le-314' as CardDefinitionId;         // greater item, 5 CP, no combat bonus

describe('Barrow-downs (le-353)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Undead automatic attack triggers with 1 strike and 8 prowess', () => {
    const state = buildMinionSitePhaseState({ site: BARROW_DOWNS, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(1);
    expect(nextState.combat!.strikeProwess).toBe(8);
    expect(nextState.combat!.creatureRace).toBe('undead');
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Wound corruption check (modified by -2) ───────────────────────────────

  test('wounded character gets a corruption check modified by -2 after the auto-attack', () => {
    const state = buildMinionSitePhaseState({ site: BARROW_DOWNS, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    // Untapped: prowess 6-3=3, roll 2 → 2+3=5 < 8 → wounded. Body check vs the
    // character (body 8): roll 5 ≤ 8 → survives wounded, so the corruption
    // check fires.
    const result = runAutoAttackCombat(readyState, THE_MOUTH, 2, 5, false);
    expect(result.state.combat).toBeNull();

    // Exactly one corruption check queued for the moving player.
    const pending = result.state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;

    // The -2 modifier from the site's auto-attack must be carried on the check.
    expect(pending[0].kind.modifier).toBe(-2);
    expect(pending[0].kind.reason).toBe('Barrow-downs');

    const mouthId = findCharInstanceId(result.state, RESOURCE_PLAYER, THE_MOUTH);
    expect(pending[0].kind.characterId).toBe(mouthId);

    // Legal actions should offer the corruption-check resolution.
    const viable = viableFor(result.state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('corruption-check');
  });

  test('corruption check after wound passes with a high roll (character survives, wounded)', () => {
    const state = buildMinionSitePhaseState({ site: BARROW_DOWNS, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    const result = runAutoAttackCombat(readyState, THE_MOUTH, 2, 5, false);

    const ccAction = viableActions(result.state, PLAYER_1, 'corruption-check')[0].action;
    // High roll (12) even at -2 → 10 vs 0 CP → passes.
    const ccState = dispatch({ ...result.state, cheatRollTotal: 12 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);
    expectCharStatus(ccState, RESOURCE_PLAYER, THE_MOUTH, CardStatus.Inverted);
  });

  test('corruption check after wound fails — character removed from play', () => {
    // The Iron Crown gives 5 CP and no combat bonus (so The Mouth is still
    // wounded); roll 2 with -2 → 0 vs 5 CP → the corruption check fails.
    const state = buildMinionSitePhaseState({
      site: BARROW_DOWNS,
      characters: [{ defId: THE_MOUTH, items: [IRON_CROWN] }],
    });
    const readyState = setupAutoAttackStep(state);

    const result = runAutoAttackCombat(readyState, THE_MOUTH, 2, 5, false);

    const ccAction = viableActions(result.state, PLAYER_1, 'corruption-check')[0].action;
    expect(ccAction.type).toBe('corruption-check');

    const ccState = dispatch({ ...result.state, cheatRollTotal: 2 }, ccAction);

    expect(ccState.pendingResolutions).toHaveLength(0);
    const mouthId = findCharInstanceId(result.state, RESOURCE_PLAYER, THE_MOUTH);
    expectCharNotInPlay(ccState, RESOURCE_PLAYER, mouthId);
  });

  test('character that wins the auto-attack strike gets no corruption check', () => {
    const state = buildMinionSitePhaseState({ site: BARROW_DOWNS, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    // Tap to fight at full prowess 6, roll 10 → 16 > 8 → wins, no wound.
    const result = runAutoAttackCombat(readyState, THE_MOUTH, 10, null);
    expect(result.state.combat).toBeNull();

    expect(result.state.pendingResolutions).toHaveLength(0);

    // Automatic-attacks step resumes (only a pass remains).
    const viable = viableFor(result.state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Item playability: minor, major (not greater) ──────────────────────────

  test('minor and major items are playable at Barrow-downs', () => {
    const state = buildMinionSitePhaseState({
      site: BARROW_DOWNS,
      characters: [{ defId: THE_MOUTH }],
      hand: [SAW_TOOTHED_BLADE, HIGH_HELM],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    const sawId = findHandCardId(state, RESOURCE_PLAYER, SAW_TOOTHED_BLADE);
    const helmId = findHandCardId(state, RESOURCE_PLAYER, HIGH_HELM);
    expect(playable).toContain(sawId);
    expect(playable).toContain(helmId);
  });

  test('greater items are NOT playable at Barrow-downs', () => {
    const state = buildMinionSitePhaseState({
      site: BARROW_DOWNS,
      characters: [{ defId: THE_MOUTH }],
      hand: [BLACK_MACE],
    });

    const maceId = findHandCardId(state, RESOURCE_PLAYER, BLACK_MACE);
    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    expect(playable).not.toContain(maceId);
  });

  // ─── Movement ──────────────────────────────────────────────────────────────

  test('starter movement from Carn Dûm reaches Barrow-downs', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Barrow-downs');
  });

  test('starter movement from Barrow-downs returns to Carn Dûm (nearest Darkhaven)', () => {
    const barrowDowns = pool[BARROW_DOWNS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, barrowDowns, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Carn Dûm');
  });

  test('not reachable from Minas Morgul via starter movement', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Barrow-downs');
  });
});
