/**
 * @module le-357.test
 *
 * Card test: Buhr Widu (le-357)
 * Type: minion-site (ruins-and-lairs)
 * Effects: none — a plain minion Ruins & Lairs with a single Troll auto-attack.
 *
 * "Nearest Darkhaven: Dol Guldur
 *  Playable: Items (minor, major)
 *  Automatic-attacks: Troll — 1 strike with 10 prowess"
 *
 * All of Buhr Widu's text is captured by structural site data — there are no
 * special rules and hence no `effects` array. The card exercises the certified
 * site engine machinery only: automatic-attack initiation (Troll, 1 strike,
 * 10 prowess), item playability gating (minor/major playable, greater not),
 * and haven-path movement to/from its nearest Darkhaven (Dol Guldur, le-367).
 *
 * NOTE: the card JSON originally had an empty `playableResources` despite the
 * "Playable: Items (minor, major)" text (the same authoritative-data mismatch
 * seen on le-353/le-403); certification filled it with [minor, major] from
 * `attributes.playable` in data/cards.json.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                    |
 * |---|-------------------|--------|------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                |
 * | 2 | sitePath          | OK     | [dark, wilderness] — matches {d}{w}      |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367)|
 * | 4 | region            | OK     | "Southern Rhovanion"                     |
 * | 5 | playableResources | OK     | [minor, major] — matches card text       |
 * | 6 | automaticAttacks  | OK     | Trolls, 1 strike, 10 prowess             |
 * | 7 | resourceDraws     | OK     | 1                                        |
 * | 8 | hazardDraws       | OK     | 1                                        |
 *
 * Engine Support:
 * | # | Feature              | Status      | Notes                              |
 * |---|----------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow      | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability     | IMPLEMENTED | minor, major playable; greater not  |
 * | 3 | Haven path movement  | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Automatic attack     | IMPLEMENTED | Troll combat, 1 strike, 10 prowess  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  resetMint, pool,
  buildMinionSitePhaseState, setupAutoAttackStep,
  runAutoAttackCombat, findHandCardId,
  dispatch, viableFor, viableActions,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const BUHR_WIDU = 'le-357' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;      // Buhr Widu's nearest Darkhaven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;    // an unrelated minion haven

const THE_MOUTH = 'le-24' as CardDefinitionId;         // Man, prowess 6

const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId; // minor item
const HIGH_HELM = 'le-313' as CardDefinitionId;         // major item
const BLACK_MACE = 'le-299' as CardDefinitionId;        // greater item

describe('Buhr Widu (le-357)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Troll automatic attack triggers with 1 strike and 10 prowess', () => {
    const state = buildMinionSitePhaseState({ site: BUHR_WIDU, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(1);
    expect(nextState.combat!.strikeProwess).toBe(10);
    expect(nextState.combat!.creatureRace).toBe('troll');
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  test('character that wins the Troll strike takes no wound and no corruption check', () => {
    const state = buildMinionSitePhaseState({ site: BUHR_WIDU, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    // Tap to fight at full prowess 6, roll 10 → 16 > 10 → wins, no wound.
    const result = runAutoAttackCombat(readyState, THE_MOUTH, 10, null);
    expect(result.state.combat).toBeNull();

    // Buhr Widu has no wound side-effects, so nothing is queued.
    expect(result.state.pendingResolutions).toHaveLength(0);

    // Automatic-attacks step resumes (only a pass remains).
    const viable = viableFor(result.state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Item playability: minor, major (not greater) ──────────────────────────

  test('minor and major items are playable at Buhr Widu', () => {
    const state = buildMinionSitePhaseState({
      site: BUHR_WIDU,
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

  test('greater items are NOT playable at Buhr Widu', () => {
    const state = buildMinionSitePhaseState({
      site: BUHR_WIDU,
      characters: [{ defId: THE_MOUTH }],
      hand: [BLACK_MACE],
    });

    const maceId = findHandCardId(state, RESOURCE_PLAYER, BLACK_MACE);
    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    expect(playable).not.toContain(maceId);
  });

  // ─── Movement ──────────────────────────────────────────────────────────────

  test('starter movement from Dol Guldur reaches Buhr Widu', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Buhr Widu');
  });

  test('starter movement from Buhr Widu returns to Dol Guldur (nearest Darkhaven)', () => {
    const buhrWidu = pool[BUHR_WIDU as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, buhrWidu, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Dol Guldur');
  });

  test('not reachable from Minas Morgul via starter movement', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Buhr Widu');
  });
});
