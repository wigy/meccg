/**
 * @module td-57.test
 *
 * Card test: Rain-drake (td-57)
 * Type: hazard-creature (Drake)
 * Effects: 0
 *
 * Text:
 *   "Drake. One strike. May also be played at a Ruins & Lairs [{R}] that
 *    has two Wildernesses [{w}] or one Coastal Sea [{c}] in its site path."
 *
 * Base stats: strikes 1, prowess 15, body — (no body check), kill MP 1.
 * Authoritative playable cost: {c}{w}{w}{w}.
 *
 * keyedTo:
 * | # | Entry                                                                 | When                                                                  |
 * |---|-----------------------------------------------------------------------|-----------------------------------------------------------------------|
 * | 1 | regionTypes: [coastal, wilderness, wilderness, wilderness]            | always (base {c}{w}{w}{w})                                            |
 * | 2 | siteTypes: [ruins-and-lairs]                                          | destinationSite.sitePath.wildernessCount ≥ 2 OR coastalCount ≥ 1      |
 *
 * Engine semantics for base keying: each distinct region type is OR'd; if a
 * type appears N times, the company's movement path must contain at least
 * N regions of that type. So `{c}{w}{w}{w}` keys when the path has ≥1
 * coastal OR ≥3 wildernesses.
 *
 * Alt keying: when the destination is a Ruins & Lairs, the site card's own
 * `sitePath` field is consulted. If it has ≥2 wildernesses or ≥1 coastal,
 * the creature keys via site-type (independent of the company's movement
 * path). This is implemented by extending the `keyedTo[].when` context
 * with `destinationSite.sitePath.{wilderness,coastal,...}Count`.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  TOLFALAS, BANDIT_LAIR,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, RegionType, SiteType,
  computeLegalActions,
  BARROW_DOWNS,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const RAIN_DRAKE = 'td-57' as CardDefinitionId;

describe('Rain-drake (td-57)', () => {
  beforeEach(() => resetMint());

  // ─── Combat: 1 strike, 15 prowess, no body, race 'drake' ───────────────

  test('combat initiates with 1 strike at 15 prowess, no body, race drake', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [RAIN_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Coastal],
      resolvedSitePathNames: ['Bay of Belfalas'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Pelargir',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId,
      { method: 'region-type' as const, value: RegionType.Coastal },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(15);
    expect(afterChain.combat!.creatureBody).toBe(null);
    expect(afterChain.combat!.creatureRace).toBe('drake');
  });

  // ─── Base keying {c}{w}{w}{w} ────────────────────────────────────────────

  test('keyable via coastal when path has one coastal region', () => {
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
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [RAIN_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Coastal],
      resolvedSitePathNames: ['Bay of Belfalas'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Pelargir',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Coastal;
    })).toBe(true);
  });

  test('keyable via wilderness when path has three wildernesses', () => {
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
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [RAIN_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur', 'Arthedain', 'Cardolan'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);
  });

  test('NOT keyable when path has only two wildernesses (and no coastal, and destination is not R&L)', () => {
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
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [RAIN_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur', 'Arthedain'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const ready: GameState = { ...state, phaseState: mh };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('NOT keyable in a single shadow region', () => {
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
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [RAIN_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Minas Morgul',
    });
    const ready: GameState = { ...state, phaseState: mh };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Alt keying at R&L with 2W or 1C in its site path ─────────────────

  test('keyable via site-type R&L when destination R&L has two wildernesses in its site path (Barrow-downs)', () => {
    // Barrow-downs (tw-375) is a Ruins-and-Lairs with sitePath = [w, w].
    // The company's movement path alone ([w, w]) does NOT satisfy the base
    // {c}{w}{w}{w} cost (needs ≥3 wildernesses or ≥1 coastal). Only the
    // alt-keying entry gated on destinationSite.sitePath should fire.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN], destinationSite: BARROW_DOWNS },
          ],
          hand: [],
          siteDeck: [BARROW_DOWNS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [RAIN_DRAKE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Cardolan', 'Eriador'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Barrow-downs',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-type' && a.keyedBy?.value === SiteType.RuinsAndLairs;
    })).toBe(true);
    // Neither base region-type should match (path has only 2 wildernesses,
    // no coastal) — verify no wilderness region-type match is offered.
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type';
    })).toBe(false);
  });

  test('keyable via site-type R&L when destination R&L has one coastal in its site path (Tolfalas)', () => {
    // Tolfalas (tw-433) is a Ruins-and-Lairs with sitePath = [w, f, c].
    // Here we deliberately give the company a non-coastal movement path
    // (e.g. a region-movement through shadow/dark) so the base {c} keying
    // via the path is NOT available. The alt should still key via the
    // destination site's own site path (1 coastal).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN], destinationSite: TOLFALAS },
          ],
          hand: [],
          siteDeck: [TOLFALAS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [RAIN_DRAKE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Tolfalas',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-type' && a.keyedBy?.value === SiteType.RuinsAndLairs;
    })).toBe(true);
  });

  test('NOT keyable at R&L whose site path lacks 2W and 1C (Bandit Lair)', () => {
    // Bandit Lair (tw-373) is R&L with sitePath = [wilderness, shadow] —
    // only 1 wilderness and 0 coastal. The alt-keying condition fails, and
    // the company's own path (1 wilderness) does not satisfy base keying.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN], destinationSite: BANDIT_LAIR },
          ],
          hand: [],
          siteDeck: [BANDIT_LAIR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [RAIN_DRAKE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Cardolan', 'Imlad Morgul'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Bandit Lair',
    });
    const ready: GameState = { ...state, phaseState: mh };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('NOT keyable at a non-R&L destination even if its site path has 2W', () => {
    // Moria (tw-413) is a Shadow-Hold with sitePath = [w, w]. The alt
    // clause is restricted to R&L destinations — this must NOT key unless
    // the company's own path already satisfies the base cost.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA },
          ],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [RAIN_DRAKE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    // Give the company a path that does NOT itself satisfy base keying
    // (only 1 wilderness, no coastal). The alt only applies at R&L, so
    // Moria's site-path should be irrelevant.
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Redhorn Gate'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...state, phaseState: mh };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── End-to-end combat from alt keying (site-type R&L) ────────────────

  test('combat initiates end-to-end when keyed via alt site-type (Barrow-downs)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN], destinationSite: BARROW_DOWNS },
          ],
          hand: [],
          siteDeck: [BARROW_DOWNS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [RAIN_DRAKE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Cardolan', 'Eriador'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Barrow-downs',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId,
      { method: 'site-type' as const, value: SiteType.RuinsAndLairs },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(15);
  });
});
