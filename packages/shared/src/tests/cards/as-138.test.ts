/**
 * @module as-138.test
 *
 * Card test: Geann a-Lisch (as-138)
 * Type: hero-site (ruins-and-lairs) in Old Pûkel-land
 * Nearest Haven: Edhellond
 *
 * Text:
 *   Nearest Haven: Edhellond
 *   Playable: Information, Items (minor, major)
 *   Automatic-attacks: Men — 4 strikes with 8 prowess
 *   Special: Any Man hazard creature can be played at this site.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                                |
 * |---|-------------------|--------|----------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                            |
 * | 2 | sitePath          | OK     | [wilderness, wilderness, wilderness] — matches {w}{w}{w}             |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid hero haven (tw-393)                              |
 * | 4 | region            | OK     | "Old Pûkel-land" — correct per card data                             |
 * | 5 | playableResources | OK     | [information, minor, major] — matches card text                      |
 * | 6 | automaticAttacks  | OK     | Men, 4 strikes, 8 prowess — data-only for now                        |
 * | 7 | resourceDraws     | OK     | 2                                                                    |
 * | 8 | hazardDraws       | OK     | 2                                                                    |
 * | 9 | effects           | OK     | site-rule: allow-creature-by-race (men)                              |
 *
 * Engine Support:
 * | # | Feature                         | Status          | Notes                                       |
 * |---|---------------------------------|-----------------|---------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED     | select-company, enter-or-skip, play-resources|
 * | 2 | Item playability (minor, major)  | IMPLEMENTED     | site.ts enforces playableResources           |
 * | 3 | Information items               | NOT IMPLEMENTED | TODO in site.ts; not blocking (general gap) |
 * | 4 | Haven path movement             | IMPLEMENTED     | movement-map.ts — Edhellond ↔ as-138        |
 * | 5 | Automatic attacks               | NOT IMPLEMENTED | auto-attack trigger stubbed; data only       |
 * | 6 | Allow Men creatures by site rule | IMPLEMENTED     | siteAllowsCreatureByRace in movement-hazard  |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, EDHELLOND,
  ASSASSIN, ORC_PATROL,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  resetMint, pool,
  buildSitePhaseState, buildTestState, viableActions,
  makeMHState,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, Phase, computeLegalActions,
  RegionType, SiteType,
} from '../../index.js';
import type { SiteCard, CardDefinitionId, GameState } from '../../index.js';

const GEANN_A_LISCH = 'as-138' as CardDefinitionId;

describe('Geann a-Lisch (as-138)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Edhellond → Geann a-Lisch ────────────────────────────────────

  test('starter movement from Edhellond reaches Geann a-Lisch', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GEANN_A_LISCH as string),
    );

    expect(starterEntry).toBeDefined();
  });

  test('starter movement from Geann a-Lisch reaches Edhellond', () => {
    const geannALisch = pool[GEANN_A_LISCH as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, geannALisch, allSites);
    const edhellondEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.name === 'Edhellond',
    );

    expect(edhellondEntry).toBeDefined();
  });

  // ─── Item playability ────────────────────────────────────────────────────────

  test('major item (Glamdring) is playable at Geann a-Lisch', () => {
    const state = buildSitePhaseState({
      site: GEANN_A_LISCH,
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

  test('minor item (Dagger of Westernesse) is playable at Geann a-Lisch', () => {
    const state = buildSitePhaseState({
      site: GEANN_A_LISCH,
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

  // ─── Allow-creature-by-race site rule ───────────────────────────────────────

  test('Assassin (Men, keyed to {B}{F}) is viable against company at Geann a-Lisch', () => {
    // Assassin is keyed to border-hold {B} and free-hold {F} only — not
    // normally playable against a wilderness×3 path or ruins-and-lairs.
    // The allow-creature-by-race rule on Geann a-Lisch bypasses keying for
    // Men creatures.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: GEANN_A_LISCH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [EDHELLOND],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ASSASSIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Old Pûkel-land', 'Andrast', 'Anfalas'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Geann a-Lisch',
      }),
    };

    const assassinInstId = mhState.players.find(p => p.id === PLAYER_2)!
      .hand.find(c => c.definitionId === (ASSASSIN as string))!.instanceId;

    const plays = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);

    const assassinPlay = plays.find(ea => {
      const a = ea.action as { cardInstanceId?: string };
      return a.cardInstanceId === (assassinInstId as string);
    });
    expect(assassinPlay).toBeDefined();
  });

  test('Assassin (Men) is NOT viable against a company at a regular ruins-and-lairs (no site rule)', () => {
    // Without the allow-creature-by-race rule, Assassin is not keyed to
    // ruins-and-lairs or a wilderness×3 path.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ASSASSIN],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Rhudaur', 'Arthedain', 'Cardolan'],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
      }),
    };

    const assassinInstId = mhState.players.find(p => p.id === PLAYER_2)!
      .hand.find(c => c.definitionId === (ASSASSIN as string))!.instanceId;

    const all = computeLegalActions(mhState, PLAYER_2).filter(
      ea => ea.action.type === 'play-hazard',
    );
    const assassinActions = all.filter(ea => {
      const a = ea.action as { cardInstanceId?: string };
      return a.cardInstanceId === (assassinInstId as string);
    });
    expect(assassinActions.length).toBeGreaterThan(0);
    expect(assassinActions.every(ea => !ea.viable)).toBe(true);
  });

  test('non-Men creature (Orc-patrol) is NOT made viable by the Geann a-Lisch site rule', () => {
    // The allow-creature-by-race rule only applies to Men. Orc-patrol is an
    // orc: keyed to wilderness/shadow/dark regions and matching site types.
    // Against a pure wilderness path without a matching site type in its
    // keying, Orc-patrol is non-viable — the site rule does not help it.
    //
    // Use a free-hold destination so Orc-patrol is not keyed (Orc-patrol
    // requires ruins-and-lairs, shadow-hold, or dark-hold as site type).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: GEANN_A_LISCH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [EDHELLOND],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Use a free-hold destination so Orc-patrol is keying-unmatched (it
    // needs ruins-and-lairs/shadow-hold/dark-hold). The site rule on Geann
    // a-Lisch only bypasses keying for Men, not for orcs.
    const mhState: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Free, RegionType.Free, RegionType.Free],
        resolvedSitePathNames: ['Anfalas', 'Andrast', 'Belfalas'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Geann a-Lisch',
      }),
    };

    const orcPatrolInstId = mhState.players.find(p => p.id === PLAYER_2)!
      .hand.find(c => c.definitionId === (ORC_PATROL as string))!.instanceId;

    const all = computeLegalActions(mhState, PLAYER_2).filter(
      ea => ea.action.type === 'play-hazard',
    );
    const orcPatrolActions = all.filter(ea => {
      const a = ea.action as { cardInstanceId?: string };
      return a.cardInstanceId === (orcPatrolInstId as string);
    });
    expect(orcPatrolActions.length).toBeGreaterThan(0);
    expect(orcPatrolActions.every(ea => !ea.viable)).toBe(true);
  });
});
