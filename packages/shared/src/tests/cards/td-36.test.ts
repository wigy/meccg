/**
 * @module td-36.test
 *
 * Card test: Itangast (td-36)
 * Type: hazard-creature (Dragon)
 * Effects: 0
 *
 * Text:
 *   "Unique. May be played at Gold Hill. Dragon. Three strikes.
 *    If Doors of Night is in play, may also be played keyed to
 *    Withered Heath, Iron Hills, Northern Rhovanion, Grey Mountain
 *    Narrows; may also be played at sites in these regions."
 *
 * Base stats: strikes 3, prowess 18, body 8, kill MP 6.
 *
 * keyedTo:
 * | # | Entry                                                                                    | When                   |
 * |---|------------------------------------------------------------------------------------------|------------------------|
 * | 1 | siteNames: [Gold Hill]                                                                   | always                 |
 * | 2 | regionNames: [Withered Heath, Iron Hills, Northern Rhovanion, Grey Mountain Narrows]     | Doors of Night in play |
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

const ITANGAST = 'td-36' as CardDefinitionId;

/** MH state simulating arrival at Gold Hill (no DoN needed). */
function mhAtGoldHill(): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Border, RegionType.Shadow, RegionType.Wilderness],
    resolvedSitePathNames: ['Anduin Vales', 'Grey Mountain Narrows', 'Withered Heath'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Gold Hill',
  });
}

/** MH state simulating arrival at a non-Gold Hill site in Withered Heath. */
function mhInWitheredHeath(): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Withered Heath'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Dancing Spire',
  });
}

/** MH state simulating arrival at a non-Gold Hill site in Iron Hills. */
function mhInIronHills(): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Iron Hills'],
    destinationSiteType: SiteType.FreeHold,
    destinationSiteName: 'Iron Hill Dwarf-hold',
  });
}

describe('Itangast (td-36)', () => {
  beforeEach(() => resetMint());

  // ─── Combat: 3 strikes, 18 prowess, race dragon ─────────────────────────

  test('combat at Gold Hill: 3 strikes at 18 prowess, body 8, race dragon', () => {
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
          hand: [ITANGAST],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhAtGoldHill() };

    const itangastId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, itangastId, companyId,
      { method: 'site-name' as const, value: 'Gold Hill' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // No attacker-chooses-defenders: assignment goes straight to defender.
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(18);
    expect(afterChain.combat!.creatureBody).toBe(8);
    expect(afterChain.combat!.creatureRace).toBe('dragon');
  });

  // ─── Keying: at Gold Hill, no DoN required ──────────────────────────────

  test('keyable at Gold Hill without Doors of Night', () => {
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
          hand: [ITANGAST],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhAtGoldHill() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-name' && a.keyedBy?.value === 'Gold Hill';
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
          hand: [ITANGAST],
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
          hand: [ITANGAST],
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

  test('keyable at sites in Iron Hills with Doors of Night (site-in-region clause)', () => {
    // Destination site is in Iron Hills. Engine adds the destination
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
          hand: [ITANGAST],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInIronHills() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Iron Hills';
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
          hand: [ITANGAST],
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
    // A non-Gold Hill destination site whose path crosses Grey Mountain Narrows.
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
          hand: [ITANGAST],
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
          hand: [ITANGAST],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    // Rhudaur wilderness path to Moria — none of Itangast's four regions.
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });
});
