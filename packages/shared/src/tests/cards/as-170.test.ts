/**
 * @module as-170.test
 *
 * Card test: Wellinghall (as-170)
 * Type: minion-site (free-hold) in Fangorn, unique
 * Effects: 0 (no special rules beyond standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur
 *   Playable: Items (minor, major)
 *   Automatic-attacks (2):
 *     (1st) Awakened Plant — 2 strikes with 10 prowess
 *     (2nd) Awakened Plant — 2 strikes with 10 prowess
 *
 * Data completion (this pass):
 *   The imported data carried only ONE Awakened Plant automatic attack, but the
 *   authoritative card database (`data/cards.json`, AS-170:
 *   `autoAttack: "Awakened Plant - 2 strikes with 10 prowess, Awakened Plant -
 *   2 strikes with 10 prowess"`) lists TWO. The second Awakened Plant attack was
 *   appended so the site initiates both sequential auto-attacks — the recurring
 *   AS/BA-site import bug (cf. ba-83). No new engine work is required: the site
 *   reducer already initiates each `automaticAttacks[]` entry in turn.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                 |
 * |---|-------------------|--------|-------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid ({F})                              |
 * | 2 | sitePath          | OK     | [dark, shadow, wilderness, wilderness] — {d}{s}{w}{w}  |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion Darkhaven (le-367)        |
 * | 4 | region            | OK     | "Fangorn" — correct per card data                     |
 * | 5 | playableResources | OK     | [minor, major] — matches text                         |
 * | 6 | automaticAttacks  | OK     | 2× Awakened Plant, 2 strikes / 10 prowess (completed) |
 * | 7 | resourceDraws     | OK     | 2                                                     |
 * | 8 | hazardDraws       | OK     | 3                                                     |
 * | 9 | effects           | OK     | [] — no special rules                                 |
 *
 * Engine Support:
 * | # | Feature                    | Status      | Notes                                          |
 * |---|----------------------------|-------------|------------------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED | select-company, enter-or-skip, play-resources  |
 * | 2 | Item-subtype gate          | IMPLEMENTED | minor/major allowed; greater blocked           |
 * | 3 | Haven path movement        | IMPLEMENTED | Dol Guldur (le-367) ↔ Wellinghall (as-170)     |
 * | 4 | Sequential automatic attacks | IMPLEMENTED | reducer-site initiates each entry in turn     |
 *
 * Playable: YES
 * Certified: 2026-07-14
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  RIVENDELL,
  DAGGER_OF_WESTERNESSE, GLAMDRING, SCROLL_OF_ISILDUR,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  dispatch, viableActions,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, Race,
} from '../../index.js';
import type { SiteCard, CardDefinitionId, SitePhaseState } from '../../index.js';

const WELLINGHALL = 'as-170' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId; // minion Darkhaven, Wellinghall's nearest haven

describe('Wellinghall (as-170)', () => {
  beforeEach(() => resetMint());

  // ─── Haven path movement: Dol Guldur ↔ Wellinghall ──────────────────────────

  test('Dol Guldur starter movement reaches Wellinghall', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (WELLINGHALL as string),
    );

    expect(entry).toBeDefined();
  });

  test('Wellinghall starter movement reaches Dol Guldur', () => {
    const wellinghall = pool[WELLINGHALL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, wellinghall, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.name === 'Dol Guldur',
    );

    expect(entry).toBeDefined();
  });

  test('Rivendell starter movement does NOT reach Wellinghall', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (WELLINGHALL as string),
    );

    expect(entry).toBeUndefined();
  });

  test('Wellinghall is not a haven, so it does not appear in Dol Guldur havenToHaven links', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(dolGuldur.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('Wellinghall')).toBe(false);
  });

  // ─── Item playability: minor & major allowed, greater blocked ───────────────
  // playableResources = [minor, major]; the legal-action layer consults this
  // list when proposing play-hero-resource actions.

  test('minor item (Dagger of Westernesse) is offered at Wellinghall', () => {
    const state = buildSitePhaseState({
      site: WELLINGHALL,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is offered at Wellinghall', () => {
    const state = buildSitePhaseState({
      site: WELLINGHALL,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (Scroll of Isildur) is NOT offered at Wellinghall (minor/major only)', () => {
    const state = buildSitePhaseState({
      site: WELLINGHALL,
      characters: [ARAGORN],
      hand: [SCROLL_OF_ISILDUR],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });

  // ─── Automatic attacks: two sequential Awakened Plant attacks ───────────────

  test('1st automatic attack: Awakened Plant — 2 strikes with 10 prowess', () => {
    const state = buildSitePhaseState({
      site: WELLINGHALL,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(10);
    expect(next.combat!.creatureRace).toBe(Race.AwakenedPlant);
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  test('2nd automatic attack: Awakened Plant — 2 strikes with 10 prowess', () => {
    const state = buildSitePhaseState({
      site: WELLINGHALL,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);
    // Simulate the first attack already resolved by advancing the counter.
    const stateAfterFirst = {
      ...readyState,
      phaseState: {
        ...(readyState.phaseState),
        automaticAttacksResolved: 1,
      } as SitePhaseState,
    };

    const next = dispatch(stateAfterFirst, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(10);
    expect(next.combat!.creatureRace).toBe(Race.AwakenedPlant);
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  test('no third automatic attack: both printed attacks resolved → combat does not start', () => {
    const state = buildSitePhaseState({
      site: WELLINGHALL,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);
    const stateAfterBoth = {
      ...readyState,
      phaseState: {
        ...(readyState.phaseState),
        automaticAttacksResolved: 2,
      } as SitePhaseState,
    };

    const next = dispatch(stateAfterBoth, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeNull();
  });
});
