/**
 * @module as-157.test
 *
 * Card test: Ovir Hollow (as-157)
 * Type: minion-site (ruins-and-lairs) in Grey Mountain Narrows
 * Effects: 0 (no special rules beyond standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur.
 *   Playable: Items (minor, major).
 *   Automatic-attacks: Dragon — 1 strike with 12 prowess.
 *
 * Like its certified hero twin (td-179), the site is Bairanax's lair:
 * `lairOf: "td-3"` ties it into the METD manifestation chain (Bairanax at
 * Home td-5 augments its automatic-attacks; defeating Bairanax suppresses
 * the printed Dragon attack) and the `hoard` keyword marks it as a hoard
 * site for hoard-item playability gates.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                |
 * |---|-------------------|--------|------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — matches {R}                      |
 * | 2 | sitePath          | OK     | [dark, wilderness, wilderness, shadow] = {d}{w}{w}{s}|
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid Darkhaven (le-367)              |
 * | 4 | region            | OK     | "Grey Mountain Narrows"                              |
 * | 5 | playableResources | OK     | [minor, major] — matches card text                   |
 * | 6 | automaticAttacks  | OK     | Dragon, 1 strike, 12 prowess — matches card text     |
 * | 7 | resourceDraws     | OK     | 2                                                    |
 * | 8 | hazardDraws       | OK     | 2                                                    |
 * | 9 | lairOf            | OK     | "td-3" (Bairanax) — mirrors hero td-179              |
 * |10 | keywords          | OK     | ["hoard"] — hoard items may be played here           |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                                      |
 * |---|-------------------------|-------------|---------------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc.         |
 * | 2 | Item playability        | IMPLEMENTED | minor, major playable; greater not          |
 * | 3 | Haven path movement     | IMPLEMENTED | Dol Guldur ↔ Ovir Hollow starter            |
 * | 4 | Region movement         | IMPLEMENTED | S. Mirkwood → Anduin Vales → GMN (dist 3)   |
 * | 5 | Automatic attacks       | IMPLEMENTED | Dragon 1×12 initiated with correct stats    |
 * | 6 | Dragon lair (lairOf)    | IMPLEMENTED | manifestations.ts at-home augment/suppress  |
 * | 7 | Hoard keyword           | IMPLEMENTED | site.keywords $includes "hoard"             |
 *
 * Playable: YES
 * Certified: 2026-07-20
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, pool, mint,
  dispatch, viableActions,
  buildMinionSitePhaseState, setupAutoAttackStep,
  addCardInPlay, addToPile,
  findHandCardId,
} from '../test-helpers.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, CardInstance, SiteCard } from '../../index.js';

const OVIR_HOLLOW = 'as-157' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

// Bairanax manifestation chain (manifestId td-3) — Ovir Hollow is its lair.
const BAIRANAX = 'td-3' as CardDefinitionId;
const BAIRANAX_AHUNT = 'td-4' as CardDefinitionId;
const BAIRANAX_AT_HOME = 'td-5' as CardDefinitionId;
// A different Dragon's At-Home (Daelomin, lair Dancing Spire) — must not augment.
const DAELOMIN_AT_HOME = 'td-11' as CardDefinitionId;

// The Mouth is a Man — a plain minion company member for site-phase fixtures.
const THE_MOUTH = 'le-24' as CardDefinitionId;

const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId; // minor item
const HIGH_HELM = 'le-313' as CardDefinitionId;         // major item
const BLACK_MACE = 'le-299' as CardDefinitionId;        // greater item — NOT playable

describe('Ovir Hollow (as-157)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Dragon 1×12 ──────────────────────────────────────────

  test('automatic attack: Dragon — 1 strike with 12 prowess', () => {
    const state = buildMinionSitePhaseState({
      site: OVIR_HOLLOW,
      characters: [{ defId: THE_MOUTH }],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(12);
    expect(next.combat!.creatureRace).toBe('dragon');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Bairanax lair: at-home augmentation and defeat suppression ─────────────

  test('Bairanax at Home appends its Dragon attack (2 strikes at 15) to Ovir Hollow', () => {
    const base = buildMinionSitePhaseState({
      site: OVIR_HOLLOW,
      characters: [{ defId: THE_MOUTH }],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, BAIRANAX_AT_HOME);

    const attacks = getActiveAutoAttacks(state, state.cardPool[OVIR_HOLLOW] as SiteCard);
    expect(attacks).toHaveLength(2);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 1, prowess: 12 });
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 2, prowess: 15 });
  });

  test('Bairanax Ahunt in play suppresses the At-Home augmentation', () => {
    const base = buildMinionSitePhaseState({
      site: OVIR_HOLLOW,
      characters: [{ defId: THE_MOUTH }],
    });
    const withAtHome = addCardInPlay(base, HAZARD_PLAYER, BAIRANAX_AT_HOME);
    const state = addCardInPlay(withAtHome, HAZARD_PLAYER, BAIRANAX_AHUNT);

    const attacks = getActiveAutoAttacks(state, state.cardPool[OVIR_HOLLOW] as SiteCard);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 1, prowess: 12 });
  });

  test("a different Dragon's At-Home does not augment Ovir Hollow", () => {
    const base = buildMinionSitePhaseState({
      site: OVIR_HOLLOW,
      characters: [{ defId: THE_MOUTH }],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, DAELOMIN_AT_HOME);

    expect(getActiveAutoAttacks(state, state.cardPool[OVIR_HOLLOW] as SiteCard)).toHaveLength(1);
  });

  test('defeating Bairanax suppresses the printed Dragon automatic-attack', () => {
    const base = buildMinionSitePhaseState({
      site: OVIR_HOLLOW,
      characters: [{ defId: THE_MOUTH }],
    });
    const bairanaxInst: CardInstance = { instanceId: mint(), definitionId: BAIRANAX };
    const state = addToPile(base, RESOURCE_PLAYER, 'outOfPlayPile', bairanaxInst);

    expect(getActiveAutoAttacks(state, state.cardPool[OVIR_HOLLOW] as SiteCard)).toHaveLength(0);
  });

  // ─── Item playability: minor, major (not greater) ───────────────────────────

  test('minor and major items are playable at Ovir Hollow, greater items are not', () => {
    const state = buildMinionSitePhaseState({
      site: OVIR_HOLLOW,
      characters: [{ defId: THE_MOUTH }],
      hand: [SAW_TOOTHED_BLADE, HIGH_HELM, BLACK_MACE],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, SAW_TOOTHED_BLADE));
    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, HIGH_HELM));
    expect(playable).not.toContain(findHandCardId(state, RESOURCE_PLAYER, BLACK_MACE));
  });

  // ─── Starter movement: Dol Guldur ↔ Ovir Hollow ─────────────────────────────

  test('starter movement from Dol Guldur reaches Ovir Hollow', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (OVIR_HOLLOW as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Ovir Hollow reaches Dol Guldur', () => {
    const ovirHollow = pool[OVIR_HOLLOW as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, ovirHollow, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starter).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Dol Guldur reaches Ovir Hollow within 3 regions', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (OVIR_HOLLOW as string),
    );

    // Southern Mirkwood (Dol Guldur) → Anduin Vales → Grey Mountain Narrows
    // (Ovir Hollow): 2 edges = distance 3.
    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(3);
  });
});
