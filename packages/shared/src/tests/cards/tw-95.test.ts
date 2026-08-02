/**
 * @module tw-95.test
 *
 * Card test: The Great Goblin (tw-95)
 * Type: hazard-creature (Orc)
 * Effects: 0 (stats handled structurally)
 *
 * Text:
 *   "Unique. Orc. One strike. May also be played on a company moving from
 *    Rivendell to Lórien or from Lórien to Rivendell. May also be played
 *    keyed to High Pass and at sites in High Pass."
 *
 * Base stats: strikes 1, prowess 12, body 7, kill MP 2.
 * Canonical playable: {D} (dark-hold).
 *
 * keyedTo:
 * | # | Entry                                          | Notes                        |
 * |---|------------------------------------------------|------------------------------|
 * | 1 | siteTypes: [dark-hold]                         | base cost from playable {D}  |
 * | 2 | regionNames: [High Pass]                       | region keying + sites-in-region (the destination site's own region appears in resolvedSitePathNames) |
 * | 3 | movingBetweenSiteNames: [Rivendell, Lórien]    | either direction; origin and destination site names must both be listed and differ |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const GREAT_GOBLIN = 'tw-95' as CardDefinitionId;

/** Base state: P1 company at `site`, hazard player holds The Great Goblin. */
function stateWithGoblin(site: CardDefinitionId): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: MINAS_TIRITH, characters: [GIMLI] }],
        hand: [GREAT_GOBLIN],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

/** MH state: company moving Rivendell → Lórien on a route avoiding High Pass. */
function mhRivendellToLorien(): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
    resolvedSitePathNames: ['Rhudaur', 'Hollin', 'Redhorn Gate', 'Wold & Foothills'],
    destinationSiteType: SiteType.Haven,
    destinationSiteName: 'Lórien',
  });
}

describe('The Great Goblin (tw-95)', () => {
  beforeEach(() => resetMint());

  // ─── Base keying: dark-hold destination ({D}) ───────────────────────────

  test('keyable at a Dark-hold destination (site-type)', () => {
    const state = stateWithGoblin(MORIA);
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow, RegionType.Dark],
        resolvedSitePathNames: ['Imlad Morgul', 'Gorgoroth'],
        destinationSiteType: SiteType.DarkHold,
        destinationSiteName: 'Minas Morgul',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-type' && a.keyedBy?.value === 'dark-hold';
    })).toBe(true);
  });

  // ─── High Pass region keying ────────────────────────────────────────────

  test('keyable to a company moving through High Pass (region-name)', () => {
    const state = stateWithGoblin(RIVENDELL);
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Border],
        resolvedSitePathNames: ['Rhudaur', 'High Pass', 'Anduin Vales'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Beorn’s House',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'High Pass';
    })).toBe(true);
  });

  test('keyable at a site in High Pass (sites-in-region clause via region-name)', () => {
    // Destination is Goblin-gate, a Shadow-hold located in High Pass. The
    // destination site's own region appears in resolvedSitePathNames, so the
    // regionNames entry covers the "at sites in High Pass" half of the text.
    const state = stateWithGoblin(RIVENDELL);
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Rhudaur', 'High Pass'],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Goblin-gate',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'High Pass';
    })).toBe(true);
  });

  // ─── Rivendell ↔ Lórien movement keying ─────────────────────────────────

  test('keyable to a company moving from Rivendell to Lórien (moving-between-sites)', () => {
    // Route deliberately avoids High Pass and the destination is a Haven, so
    // only the movingBetweenSiteNames entry can match.
    const state = stateWithGoblin(RIVENDELL);
    const ready: GameState = { ...state, phaseState: mhRivendellToLorien() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'moving-between-sites' && a.keyedBy?.value === 'Rivendell to Lórien';
    })).toBe(true);
  });

  test('keyable to a company moving from Lórien to Rivendell (reverse direction)', () => {
    const state = stateWithGoblin(LORIEN);
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Wold & Foothills', 'Redhorn Gate', 'Hollin', 'Rhudaur'],
        destinationSiteType: SiteType.Haven,
        destinationSiteName: 'Rivendell',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'moving-between-sites' && a.keyedBy?.value === 'Lórien to Rivendell';
    })).toBe(true);
  });

  test('NOT keyable to a company moving from Rivendell to a site outside the route', () => {
    // Origin is listed but the destination (Moria) is not, the path avoids
    // High Pass, and the destination is not a Dark-hold — nothing matches.
    const state = stateWithGoblin(RIVENDELL);
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Rhudaur', 'Hollin'],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('NOT keyable to a non-moving company at Lórien (origin equals destination)', () => {
    const state = stateWithGoblin(LORIEN);
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.Haven,
        destinationSiteName: 'Lórien',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  // ─── Combat: one strike at 12, body 7, Orc (validation side included) ───

  test('playing on the Rivendell → Lórien route starts combat with 1 strike at 12/7', () => {
    // Goes through the real reducer, so checkCreatureKeying must accept the
    // moving-between-sites keying too.
    const state = stateWithGoblin(RIVENDELL);
    const ready: GameState = { ...state, phaseState: mhRivendellToLorien() };

    const goblinId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, goblinId, companyId,
      { method: 'moving-between-sites' as const, value: 'Rivendell to Lórien' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(12);
    expect(afterChain.combat!.creatureBody).toBe(7);
    expect(afterChain.combat!.creatureRace).toBe('orc');
  });
});
