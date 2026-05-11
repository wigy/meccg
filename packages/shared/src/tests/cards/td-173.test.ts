/**
 * @module td-173.test
 *
 * Card test: Buhr Widu (td-173)
 * Type: hero-site (ruins-and-lairs) in Southern Rhovanion
 * Effects: 1 — `site-rule: always-return-to-deck`
 *
 * Text:
 *   Nearest Haven: Lórien.
 *   Playable: Items (minor, major).
 *   Automatic-attacks: Troll — 1 strike with 10 prowess.
 *   Special: This site is always returned to the location deck,
 *     never to the discard pile.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                          |
 * | 2 | sitePath          | OK     | [wilderness, border, wilderness, wilderness,        |
 * |   |                   |        |  wilderness] — long region path                    |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                |
 * | 4 | region            | OK     | "Southern Rhovanion"                               |
 * | 5 | playableResources | OK     | [minor, major] — matches card text                 |
 * | 6 | automaticAttacks  | OK     | Trolls — 1 strike at prowess 10                    |
 * | 7 | resourceDraws     | OK     | 3                                                  |
 * | 8 | hazardDraws       | OK     | 3                                                  |
 *
 * Engine Support:
 * | # | Feature                              | Status      | Notes                                    |
 * |---|--------------------------------------|-------------|------------------------------------------|
 * | 1 | Site phase flow                      | IMPLEMENTED | select-company, enter-or-skip, resources |
 * | 2 | Item playability (minor, major)      | IMPLEMENTED | both allowed; greater/gold-ring denied   |
 * | 3 | Haven path movement                  | IMPLEMENTED | movement-map.ts → nearestHaven = Lórien  |
 * | 4 | `site-rule: always-return-to-deck`   | IMPLEMENTED | MH step 8 bypasses discard path          |
 *
 * Playable: YES
 * Certified: 2026-05-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, RIVENDELL,
  DAGGER_OF_WESTERNESSE, GLAMDRING,
  THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  resetMint, pool,
  buildTestState, makeMHState,
  dispatch,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import { Phase, CardStatus, isSiteCard, buildMovementMap, getReachableSites } from '../../index.js';
import type { GameState, CardDefinitionId, SiteCard } from '../../index.js';

const BUHR_WIDU = 'td-173' as CardDefinitionId;

describe('Buhr Widu (td-173)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor items are playable at Buhr Widu', () => {
    const state = buildSitePhaseState({
      site: BUHR_WIDU,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Buhr Widu', () => {
    const state = buildSitePhaseState({
      site: BUHR_WIDU,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are NOT playable at Buhr Widu', () => {
    const state = buildSitePhaseState({
      site: BUHR_WIDU,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('gold-ring items are NOT playable at Buhr Widu', () => {
    const state = buildSitePhaseState({
      site: BUHR_WIDU,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  // ─── always-return-to-deck: tapped site returns to deck, not discard ───────

  test('tapped Buhr Widu (site of origin) goes back to location deck, not site discard pile', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BUHR_WIDU, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [LORIEN],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const company = built.players[0].companies[0];
    const lorienSite = built.players[0].siteDeck.find(
      c => c.definitionId === LORIEN,
    )!;
    const buhrWiduOriginId = company.currentSite!.instanceId;

    // Model a company that moved from Buhr Widu (tapped after playing there)
    // to Lórien.
    const state: GameState = {
      ...built,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      }),
      players: [
        {
          ...built.players[0],
          companies: [{
            ...company,
            currentSite: { ...company.currentSite!, status: CardStatus.Tapped },
            siteCardOwned: true,
            destinationSite: {
              instanceId: lorienSite.instanceId,
              definitionId: lorienSite.definitionId,
              status: CardStatus.Untapped,
            },
            siteOfOrigin: buhrWiduOriginId,
          }],
          siteDeck: built.players[0].siteDeck,
        },
        built.players[1],
      ],
    };

    const afterResourcePass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const p1 = afterBothPass.players[0];
    // Should be back in the location deck, NOT in the site discard pile.
    expect(p1.siteDeck.some(c => c.instanceId === buhrWiduOriginId)).toBe(true);
    expect(p1.siteDiscardPile.some(c => c.instanceId === buhrWiduOriginId)).toBe(false);
  });

  test('untapped Buhr Widu (site of origin) also goes back to location deck', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BUHR_WIDU, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [LORIEN],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const company = built.players[0].companies[0];
    const lorienSite = built.players[0].siteDeck.find(
      c => c.definitionId === LORIEN,
    )!;
    const buhrWiduOriginId = company.currentSite!.instanceId;

    // Company moves away from Buhr Widu while it is untapped (did not play
    // anything there). Should also return to deck (same as any non-haven).
    const state: GameState = {
      ...built,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      }),
      players: [
        {
          ...built.players[0],
          companies: [{
            ...company,
            siteCardOwned: true,
            destinationSite: {
              instanceId: lorienSite.instanceId,
              definitionId: lorienSite.definitionId,
              status: CardStatus.Untapped,
            },
            siteOfOrigin: buhrWiduOriginId,
          }],
          siteDeck: built.players[0].siteDeck,
        },
        built.players[1],
      ],
    };

    const afterResourcePass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const p1 = afterBothPass.players[0];
    expect(p1.siteDeck.some(c => c.instanceId === buhrWiduOriginId)).toBe(true);
    expect(p1.siteDiscardPile.some(c => c.instanceId === buhrWiduOriginId)).toBe(false);
  });

  // ─── Movement: Lórien → Buhr Widu ─────────────────────────────────────────

  test('starter movement from Lórien reaches Buhr Widu', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (BUHR_WIDU as string),
    );
    expect(starterEntry).toBeDefined();
  });
});
