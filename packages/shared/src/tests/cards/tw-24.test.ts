/**
 * @module tw-24.test
 *
 * Card test: Corsairs of Umbar (tw-24)
 * Type: hazard-creature (Men)
 * Effects: 0
 *
 * Text:
 *   "Men. Five strikes. May also be played keyed to Andrast, Anfalas,
 *    Belfalas, Cardolan, Enedhwaith, Harondor, Lindon, Lebennin, and Old
 *    Pûkel-land; and may also be played at Ruins & Lairs [R] and
 *    Shadow-holds [S] in these regions. May also be played at any site in
 *    Elven Shores, Eriadoran Coast, Andrast Coast, Bay of Belfalas, or
 *    Mouths of the Anduin."
 *
 * (CRF 22 erratum: "Add: May also be played at any sites in Elven Shores,
 * Eriadoran Coast, Andrast Coast, Bay of Belfalas, or Mouths of the
 * Anduin.")
 *
 * keyedTo:
 * | # | Entry                                                                    |
 * |---|---------------------------------------------------------------------------|
 * | 1 | siteInRegionNames: [Elven Shores, Eriadoran Coast, Andrast Coast,        |
 * |   |   Bay of Belfalas, Mouths of the Anduin]                                 |
 * | 2 | regionNames: [Andrast, Anfalas, Belfalas, Cardolan, Enedhwaith,          |
 * |   |   Harondor, Lindon, Lebennin, Old Pûkel-land]                            |
 *
 * Note: entry 1 must match the destination site's own region regardless of
 * whether the company moved this turn — a company that stayed put at a
 * site in one of these regions (empty `resolvedSitePath`) is still a
 * legal target. Using `regionTypes: ["coastal"]` instead (as the data used
 * to) only matches a *traversed* path, so a stationary company was
 * incorrectly rejected.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, ANBORN,
  TOLFALAS, MORIA, MINAS_TIRITH, RIVENDELL,
  buildTestState, resetMint, makeMHState,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, SiteType } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const CORSAIRS_OF_UMBAR = 'tw-24' as CardDefinitionId;

describe('Corsairs of Umbar (tw-24)', () => {
  beforeEach(() => resetMint());

  test('keyable at Tolfalas (Mouths of the Anduin) even when the company did not move this turn', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: TOLFALAS, characters: [ANBORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [CORSAIRS_OF_UMBAR],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    // Company stayed at its current site (Tolfalas) — no movement this
    // turn, so resolvedSitePath/resolvedSitePathNames are empty.
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Tolfalas',
      }),
    };

    const corsairsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    expect(corsairsId).toBeTruthy();
    expect(companyId).toBeTruthy();

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-in-region' && a.keyedBy?.value === 'Mouths of the Anduin';
    })).toBe(true);
  });

  test('NOT keyable at a site outside the listed regions', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [CORSAIRS_OF_UMBAR],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria Redhorn Gate',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });
});
