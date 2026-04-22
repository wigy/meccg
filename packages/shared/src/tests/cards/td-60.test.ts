/**
 * @module td-60.test
 *
 * Card test: Scatha (td-60)
 * Type: hazard-creature (Dragon)
 * Effects: 0
 *
 * Text:
 *   "Unique. May be played at Gondmaeglom. Dragon. Three strikes.
 *    If Doors of Night is in play, may also be played keyed to
 *    Withered Heath, Woodland Realm, Northern Rhovanion, and Grey
 *    Mountain Narrows; and may also be played at sites in these
 *    regions."
 *
 * Base stats: strikes 3, prowess 15, body 9, kill MP 5.
 *
 * keyedTo:
 * | # | Entry                                                                                         | When                   |
 * |---|-----------------------------------------------------------------------------------------------|------------------------|
 * | 1 | siteNames: [Gondmaeglom]                                                                      | always                 |
 * | 2 | regionNames: [Withered Heath, Woodland Realm, Northern Rhovanion, Grey Mountain Narrows]      | Doors of Night in play |
 *
 * Note: "may also be played at sites in these regions" is covered by the
 * same regionNames entry — the engine adds the destination site's region
 * to `resolvedSitePathNames`, so the regionNames matcher catches both
 * "company keyed to the region" and "destination site in the region".
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, makeWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, RegionType, SiteType, CardStatus,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const SCATHA = 'td-60' as CardDefinitionId;

/** MH state simulating arrival at Gondmaeglom (no DoN needed). */
function mhAtGondmaeglom(): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Border, RegionType.Shadow],
    resolvedSitePathNames: ['Anduin Vales', 'Grey Mountain Narrows'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Gondmaeglom',
  });
}

/** MH state simulating arrival at a non-Gondmaeglom site in Withered Heath. */
function mhInWitheredHeath(): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Withered Heath'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Dancing Spire',
  });
}

/** MH state simulating arrival at a non-Gondmaeglom site in Woodland Realm. */
function mhInWoodlandRealm(): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Woodland Realm'],
    destinationSiteType: SiteType.FreeHold,
    destinationSiteName: 'Thranduil’s Halls',
  });
}

describe('Scatha (td-60)', () => {
  beforeEach(() => resetMint());

  // ─── Combat: 3 strikes, 15 prowess, race dragon ─────────────────────────

  test('combat at Gondmaeglom: 3 strikes at 15 prowess, body 9, race dragon', () => {
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
          hand: [SCATHA],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhAtGondmaeglom() };

    const scathaId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, scathaId, companyId,
      { method: 'site-name' as const, value: 'Gondmaeglom' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // No attacker-chooses-defenders: assignment goes straight to defender.
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(15);
    expect(afterChain.combat!.creatureBody).toBe(9);
    expect(afterChain.combat!.creatureRace).toBe('dragon');
  });

  // ─── Keying: at Gondmaeglom, no DoN required ────────────────────────────

  test('keyable at Gondmaeglom without Doors of Night', () => {
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
          hand: [SCATHA],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhAtGondmaeglom() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-name' && a.keyedBy?.value === 'Gondmaeglom';
    })).toBe(true);
  });

  // ─── Keying: regions require Doors of Night ─────────────────────────────

  test('NOT keyable to Withered Heath region without Doors of Night', () => {
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
          hand: [SCATHA],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInWitheredHeath() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    // The play-hazard entry exists but is non-viable, tagged with a keying error.
    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('keyable to Withered Heath region when Doors of Night IS in play', () => {
    const donInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
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
          hand: [SCATHA],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInWitheredHeath() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Withered Heath';
    })).toBe(true);
  });

  test('keyable at sites in Woodland Realm with Doors of Night (site-in-region clause)', () => {
    // Destination site is in Woodland Realm. Engine adds the destination
    // site's region to resolvedSitePathNames, so the regionNames keying
    // entry matches.
    const donInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
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
          hand: [SCATHA],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInWoodlandRealm() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Woodland Realm';
    })).toBe(true);
  });

  test('keyable to Northern Rhovanion region with Doors of Night', () => {
    const donInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
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
          hand: [SCATHA],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Wold & Foothills', 'Northern Rhovanion'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Dol Guldur',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Northern Rhovanion';
    })).toBe(true);
  });

  test('keyable to Grey Mountain Narrows region with Doors of Night', () => {
    // A non-Gondmaeglom destination site whose path crosses Grey Mountain Narrows.
    const donInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
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
          hand: [SCATHA],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Border, RegionType.Shadow],
      resolvedSitePathNames: ['Anduin Vales', 'Grey Mountain Narrows'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Goblin-gate',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Grey Mountain Narrows';
    })).toBe(true);
  });

  test('NOT keyable to an unrelated region even with Doors of Night', () => {
    const donInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
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
          hand: [SCATHA],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    // Rhudaur wilderness path to Moria — none of Scatha's four regions.
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });
});
