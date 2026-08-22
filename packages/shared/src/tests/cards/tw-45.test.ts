/**
 * @module tw-45.test
 *
 * Card test: Huorn (tw-45)
 * Type: hazard-creature (Awakened Plant)
 * Effects: 0 (structural keying only)
 *
 * Text:
 *   "Awakened Plant. One strike. May also be played at Drúadan Forest, Old
 *    Forest, and Wellinghall. May also be played keyed to Heart of Mirkwood,
 *    Southern Mirkwood, Western Mirkwood, and Woodland Realm; and may also
 *    be played at Ruins & Lairs [{R}] and Shadow-holds [{S}] in these
 *    regions."
 *
 * Base stats: strikes 1, prowess 10, body — (no body check), kill MP 1.
 * Authoritative playable cost: {w} (one Wilderness).
 *
 * keyedTo:
 * | # | Entry                                                             | When                                                     |
 * |---|-------------------------------------------------------------------|-----------------------------------------------------------|
 * | 1 | regionTypes: [wilderness]                                        | always (base {w})                                          |
 * | 2 | siteNames: [Drúadan Forest, Old Forest, Wellinghall]             | destination site name matches, any path                    |
 * | 3 | regionNames: [4 Mirkwood regions]                                | company moving through one of the named regions            |
 * | 4 | siteTypes: [ruins-and-lairs, shadow-hold]                        | destinationSite.region ∈ the 4 named regions               |
 *
 * Per CoE rule 2.IV.vii.2, region-name keying (entry 3) requires the company
 * to be *moving through* a matching region, while site-type keying (entry 4)
 * matches the company's new site whether moving or not. Entry 3 alone would
 * therefore not reach a company already sitting at a qualifying site with no
 * movement this turn, and — being a plain region-name entry — would not
 * exclude Free-holds/Border-holds/Havens within the same four regions
 * either. Entry 4 is the region-scoped site-type keying introduced for this
 * card: a `siteTypes` restriction gated by a `when: { "destinationSite.region":
 * { "$in": [...] } }` clause, narrower than the ungated "or at sites in these
 * regions" shape used elsewhere (as-13/as-21/tw-90/tw-95/tw-46), which prints
 * no site-type restriction.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, RegionType, SiteType,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const HUORN = 'tw-45' as CardDefinitionId;

/** Named sites the creature may be played at directly, regardless of path (entry 2). */
const DRUADAN_FOREST = 'tw-388' as CardDefinitionId; // border-hold, Anórien
const OLD_FOREST = 'tw-417' as CardDefinitionId;      // border-hold, Cardolan
const WELLINGHALL = 'tw-437' as CardDefinitionId;     // free-hold, Fangorn

/** A Shadow-hold inside one of the four named regions (entry 4 should key here). */
const SARN_GORIWING = 'tw-423' as CardDefinitionId; // shadow-hold, Heart of Mirkwood

/** A Free-hold inside one of the four named regions (entry 4 must NOT key here — wrong site type). */
const RHOSGOBEL = 'tw-420' as CardDefinitionId; // free-hold, Southern Mirkwood

describe('Huorn (tw-45)', () => {
  beforeEach(() => resetMint());

  // ─── Combat: 1 strike, 10 prowess, no body, race awakened-plant ────────

  test('combat initiates with 1 strike at 10 prowess, no body, race awakened-plant', () => {
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
          hand: [HUORN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Redhorn Gate'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const huornId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, huornId, companyId,
      { method: 'region-type' as const, value: RegionType.Wilderness },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(10);
    expect(afterChain.combat!.creatureBody).toBe(null);
    expect(afterChain.combat!.creatureRace).toBe('awakened-plant');
  });

  // ─── Base keying {w} ─────────────────────────────────────────────────

  test('keyable via wilderness when path has one wilderness', () => {
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
          hand: [HUORN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Redhorn Gate'],
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

  test('NOT keyable in a single shadow region at a non-qualifying site', () => {
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
          hand: [HUORN],
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

  // ─── Named-site keying (Drúadan Forest, Old Forest, Wellinghall) ──────

  test('keyable by name at Drúadan Forest regardless of path', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN], destinationSite: DRUADAN_FOREST },
          ],
          hand: [],
          siteDeck: [DRUADAN_FOREST],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [HUORN],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Drúadan Forest',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-name' && a.keyedBy?.value === 'Drúadan Forest';
    })).toBe(true);
  });

  test('keyable by name at Old Forest and Wellinghall regardless of path', () => {
    for (const [siteId, siteName] of [[OLD_FOREST, 'Old Forest'], [WELLINGHALL, 'Wellinghall']] as const) {
      resetMint();
      const state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        recompute: true,
        players: [
          {
            id: PLAYER_1,
            companies: [
              { site: RIVENDELL, characters: [ARAGORN], destinationSite: siteId },
            ],
            hand: [],
            siteDeck: [siteId],
          },
          {
            id: PLAYER_2,
            companies: [{ site: LORIEN, characters: [GIMLI] }],
            hand: [HUORN],
            siteDeck: [MINAS_TIRITH],
          },
        ],
      });
      const mh = makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Imlad Morgul'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: siteName,
      });
      const ready: GameState = { ...state, phaseState: mh };

      const plays = viableActions(ready, PLAYER_2, 'play-hazard');
      expect(plays.some(p => {
        const a = p.action as { keyedBy?: { method: string; value: string } };
        return a.keyedBy?.method === 'site-name' && a.keyedBy?.value === siteName;
      })).toBe(true);
    }
  });

  // ─── Region-name keying (the four named Mirkwood regions) ────────────

  test('keyable via region-name when moving through Southern Mirkwood, at a non-qualifying site type', () => {
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
          hand: [HUORN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Southern Mirkwood'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Dol Guldur',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Southern Mirkwood';
    })).toBe(true);
  });

  // ─── Region-scoped site-type keying (R&L / Shadow-hold in the 4 regions) ──

  test('keyable via site-type at Sarn Goriwing (Shadow-hold in Heart of Mirkwood) even without the region on the movement path', () => {
    // resolvedSitePathNames deliberately omits "Heart of Mirkwood" so this
    // only passes through the new destinationSite.region-gated siteTypes
    // entry, not the plain regionNames entry.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN], destinationSite: SARN_GORIWING },
          ],
          hand: [],
          siteDeck: [SARN_GORIWING],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [HUORN],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Sarn Goriwing',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-type' && a.keyedBy?.value === SiteType.ShadowHold;
    })).toBe(true);
    // The plain region-name entry must NOT be what matched (it's absent from the path).
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name';
    })).toBe(false);
  });

  test('NOT keyable at Rhosgobel (Free-hold in Southern Mirkwood) — wrong site type for the region-scoped entry', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN], destinationSite: RHOSGOBEL },
          ],
          hand: [],
          siteDeck: [RHOSGOBEL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [HUORN],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Rhosgobel',
    });
    const ready: GameState = { ...state, phaseState: mh };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('NOT keyable at Moria (Shadow-hold outside the four named regions)', () => {
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
          hand: [HUORN],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...state, phaseState: mh };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── End-to-end combat from region-scoped site-type keying ────────────

  test('combat initiates end-to-end when keyed via region-scoped site-type (Sarn Goriwing)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN], destinationSite: SARN_GORIWING },
          ],
          hand: [],
          siteDeck: [SARN_GORIWING],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [HUORN],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Sarn Goriwing',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const huornId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, huornId, companyId,
      { method: 'site-type' as const, value: SiteType.ShadowHold },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(10);
  });
});
