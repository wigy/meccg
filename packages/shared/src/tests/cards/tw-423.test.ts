/**
 * @module tw-423.test
 *
 * Card test: Sarn Goriwing (tw-423)
 * Type: hero-site (shadow-hold)
 * Effects: 0
 *
 * "Nearest Haven: Lórien
 *  Playable: Items (minor, major)
 *  Automatic-attacks: Orcs — 3 strikes with 5 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                            |
 * |---|-------------------|--------|--------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                            |
 * | 2 | sitePath          | OK     | [wilderness, border, wilderness, wilderness]      |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool              |
 * | 4 | region            | OK     | "Heart of Mirkwood"                              |
 * | 5 | playableResources | OK     | [minor, major] — matches card text               |
 * | 6 | automaticAttacks  | OK     | Orcs, 3 strikes, 5 prowess — matches card text   |
 * | 7 | resourceDraws     | OK     | 2                                                |
 * | 8 | hazardDraws       | OK     | 2                                                |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                               |
 * |---|---------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability    | IMPLEMENTED | minor, major via playableResources  |
 * | 3 | Haven path movement | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Card draws          | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 5 | Automatic attacks   | IMPLEMENTED | Orcs combat initiated correctly     |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LORIEN, MINAS_TIRITH, LEGOLAS,
  resetMint, pool,
  buildSitePhaseState,
  buildTestState,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT,
  isSiteCard, buildMovementMap, getReachableSites, Phase, Alignment,
} from '../../index.js';
import { reduce } from '../../engine/reducer.js';
import type {
  SiteCard, SitePhaseState, CardDefinitionId, GameState,
} from '../../index.js';

const SARN_GORIWING = 'tw-423' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;

describe('Sarn Goriwing (tw-423)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor items are playable at Sarn Goriwing', () => {
    const state = buildSitePhaseState({
      site: SARN_GORIWING,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Sarn Goriwing', () => {
    const state = buildSitePhaseState({
      site: SARN_GORIWING,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are not playable at Sarn Goriwing', () => {
    const state = buildSitePhaseState({
      site: SARN_GORIWING,
      hand: [THE_MITHRIL_COAT],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (SARN_GORIWING as string),
    );

    expect(entry).toBeDefined();
  });

  // ─── Automatic attacks ────────────────────────────────────────────────────

  test('Orcs automatic attack triggers with 3 strikes and 5 prowess', () => {
    const state = buildSitePhaseState({ site: SARN_GORIWING });
    const autoAttackState: SitePhaseState = {
      ...state.phaseState,
      step: 'automatic-attacks',
      siteEntered: false,
      automaticAttacksResolved: 0,
    };
    const readyState = { ...state, phaseState: autoAttackState };

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(3);
    expect(nextState.combat!.strikeProwess).toBe(5);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  test('Orcs automatic attack is NOT detainment against a Ringwraith company', () => {
    // Regression: bug report msotr1yy-z2yrcq, seq 95. Sarn Goriwing's card
    // text is plain — "Automatic-attacks: Orcs — 3 strikes with 5 prowess" —
    // with no detainment qualifier of any kind. A site's own automatic-attack
    // is not a hazard creature card, so per the CoE glossary ("only attacks
    // from hazard creature cards are considered keyed") it is never
    // implicitly "keyed to" the site's shadow-hold type, and §3.II.2.R1 (which
    // requires keying) does not detain a Ringwraith company here.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: SARN_GORIWING, characters: [ORC_CAPTAIN] }],
          hand: [],
          siteDeck: [LORIEN],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'automatic-attacks' as const,
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      siteEntered: false,
      resourcePlayed: false,
      minorItemAvailable: false,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      automaticAttacksResolved: 0,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const state: GameState = { ...base, phaseState: sitePhaseState };

    const { state: afterAttack, error } = reduce(state, { type: 'pass', player: PLAYER_1 });

    expect(error).toBeUndefined();
    expect(afterAttack.combat).not.toBeNull();
    expect(afterAttack.combat!.creatureRace).toBe('orc');
    expect(afterAttack.combat!.detainment).toBe(false);
  });
});
