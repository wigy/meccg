/**
 * @module le-92.test
 *
 * Card test: Stirring Bones (le-92)
 * Type: hazard-creature (Undead)
 * Effects: 0
 *
 * Text:
 *   "Undead. Two strikes."
 *
 * Base stats: strikes 2, prowess 9, body — (no body check), kill MP 1,
 * non-unique.
 *
 * keyedTo (canonical playable: {w}{w}{s}{d}{R}{S}):
 * | # | Entry                                              | Matches when…                          |
 * |---|----------------------------------------------------|----------------------------------------|
 * | 1 | regionTypes: [wilderness, wilderness, shadow, dark]| ≥2 wilderness OR ≥1 shadow OR ≥1 dark  |
 * | 2 | siteTypes: [ruins-and-lairs, shadow-hold]          | destination is R&L OR shadow-hold      |
 *
 * Keying is OR across every token: the creature is playable if the path
 * holds at least two Wildernesses, OR at least one Shadow-land, OR at least
 * one Dark-domain, OR the destination site is a Ruins & Lairs or a
 * Shadow-hold. The two-wilderness count (not just one) is required for the
 * {w}{w} token.
 *
 * Effects: none — "Undead" is the race designation (data field) and
 * "Two strikes" restates the `strikes` value. Both are handled structurally
 * by the engine.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BREE,
  buildTestState, resetMint,
  makeMHState, makeDoubleWildernessMHState,
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

const STIRRING_BONES = 'le-92' as CardDefinitionId;

describe('Stirring Bones (le-92)', () => {
  beforeEach(() => resetMint());

  // ─── Combat stats: 2 strikes at 9 prowess, no body, undead race ──────

  test('combat initiates with 2 strikes at 9 prowess, no body check, undead race', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [STIRRING_BONES],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    // Double-wilderness path to Moria keys via {w}{w}.
    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };

    const bonesId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, bonesId, companyId,
      { method: 'region-type' as const, value: RegionType.Wilderness },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(9);
    expect(afterChain.combat!.creatureBody).toBeNull();
    expect(afterChain.combat!.creatureRace).toBe('undead');
  });

  // ─── Keying token {w}{w}: two Wildernesses required ──────────────────

  test('keyable via wilderness on a double-wilderness path (border-hold dest isolates the region token)', () => {
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
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [STIRRING_BONES],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Rhudaur', 'Arthedain'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    const methodsAndValues = plays.map(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return `${a.keyedBy?.method}:${a.keyedBy?.value}`;
    });
    expect(methodsAndValues).toContain(`region-type:${RegionType.Wilderness}`);
    // Border-hold is not a keyed site type, so no site-type match is offered.
    expect(methodsAndValues).not.toContain(`site-type:${SiteType.BorderHold}`);
  });

  test('NOT keyable on a single-wilderness path with a non-keyed destination ({w}{w} needs two)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [STIRRING_BONES],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Rhudaur'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      }),
    };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  // ─── Keying token {s}: one Shadow-land ───────────────────────────────

  test('keyable via shadow region on a shadow path to a non-keyed destination', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [STIRRING_BONES],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Imlad Morgul'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Shadow;
    })).toBe(true);
  });

  // ─── Keying token {d}: one Dark-domain ───────────────────────────────

  test('keyable via dark region on a dark path to a non-keyed destination', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [STIRRING_BONES],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Dark],
        resolvedSitePathNames: ['Gorgoroth'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Dark;
    })).toBe(true);
  });

  // ─── Keying token {R}: Ruins & Lairs destination ─────────────────────

  test('keyable via Ruins-and-Lairs destination on a non-keyed region path', () => {
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
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [STIRRING_BONES],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        // Border region is not a keyed region type; only the R&L site keys.
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Andrast'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    const methodsAndValues = plays.map(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return `${a.keyedBy?.method}:${a.keyedBy?.value}`;
    });
    expect(methodsAndValues).toContain(`site-type:${SiteType.RuinsAndLairs}`);
    // Border region is not a keyed region type, so it offers no region-type match.
    expect(methodsAndValues).not.toContain(`region-type:${RegionType.Border}`);
  });

  // ─── Keying token {S}: Shadow-hold destination ───────────────────────

  test('keyable via Shadow-hold destination on a non-keyed region path', () => {
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
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [STIRRING_BONES],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Andrast'],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Dol Guldur',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-type' && a.keyedBy?.value === SiteType.ShadowHold;
    })).toBe(true);
  });

  // ─── Negative: no token satisfied ────────────────────────────────────

  test('NOT keyable when the path has no keyed region and a non-keyed destination', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [STIRRING_BONES],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        // Free region + free-hold: neither a keyed region nor a keyed site type.
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['Anorien'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Edoras',
      }),
    };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });
});
