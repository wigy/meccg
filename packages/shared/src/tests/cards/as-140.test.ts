/**
 * @module as-140.test
 *
 * Card test: Nûrniag Camp (as-140)
 * Type: hero-site (shadow-hold) in Nurn
 * Effects: 0 (no special rules beyond standard site data fields)
 *
 * Text:
 *   Nearest Haven: Edhellond
 *   Playable: Information, Items (minor, major)
 *   Automatic-attacks: Men — 4 strikes with 7 prowess
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                          |
 * |---|-------------------|--------|----------------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                                          |
 * | 2 | sitePath          | OK     | [wilderness, free, coastal-sea, wilderness, shadow]            |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid hero haven (tw-393)                        |
 * | 4 | region            | OK     | "Nurn"                                                         |
 * | 5 | playableResources | OK     | [information, minor, major] — matches card text (was [] — fixed)|
 * | 6 | automaticAttacks  | OK     | Men, 4 strikes / 7 prowess                                     |
 * | 7 | resourceDraws     | OK     | 3                                                              |
 * | 8 | hazardDraws       | OK     | 5                                                              |
 *
 * Engine Support:
 * | # | Feature                    | Status          | Notes                                           |
 * |---|----------------------------|-----------------|-------------------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED     | select-company, enter-or-skip, play-resources   |
 * | 2 | Haven path movement        | IMPLEMENTED     | movement-map.ts — Edhellond ↔ Nûrniag Camp      |
 * | 3 | Item playability (minor, major) | IMPLEMENTED | site.ts enforces playableResources             |
 * | 4 | Information items          | NOT IMPLEMENTED | TODO in site.ts; engine-wide gap, not card-specific |
 * | 5 | Automatic attacks          | NOT IMPLEMENTED | auto-attack trigger stubbed; data only          |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  EDHELLOND,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  viableActions,
  dispatch,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const NURNIAG_CAMP = 'as-140' as CardDefinitionId;

describe('Nûrniag Camp (as-140)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Men 4/7 ──────────────────────────────────────────────

  test('automatic attack: Men — 4 strikes with 7 prowess', () => {
    const state = buildSitePhaseState({
      site: NURNIAG_CAMP,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(7);
    expect(next.combat!.creatureRace).toBe('man');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at Nûrniag Camp', () => {
    const state = buildSitePhaseState({
      site: NURNIAG_CAMP,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const daggerInstId = state.players[0].hand[0].instanceId;

    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.some(ea => {
      const a = ea.action as { cardInstanceId?: string };
      return a.cardInstanceId === (daggerInstId as string);
    })).toBe(true);
  });

  test('major item (Glamdring) is playable at Nûrniag Camp', () => {
    const state = buildSitePhaseState({
      site: NURNIAG_CAMP,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const glamdringInstId = state.players[0].hand[0].instanceId;

    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.some(ea => {
      const a = ea.action as { cardInstanceId?: string };
      return a.cardInstanceId === (glamdringInstId as string);
    })).toBe(true);
  });

  // ─── Movement: Edhellond ↔ Nûrniag Camp ─────────────────────────────────────

  test('starter movement from Edhellond reaches Nûrniag Camp', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (NURNIAG_CAMP as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Nûrniag Camp reaches Edhellond', () => {
    const nurniagCamp = pool[NURNIAG_CAMP as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, nurniagCamp, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EDHELLOND as string),
    );

    expect(starter).toBeDefined();
  });
});
