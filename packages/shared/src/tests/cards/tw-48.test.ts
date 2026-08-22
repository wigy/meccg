/**
 * @module tw-48.test
 *
 * Card test: Leucaruth (tw-48)
 * Type: hazard-creature (Dragon)
 * Effects: 0
 *
 * Text:
 *   "Unique. May be played at Irerock. Dragon. Two strikes.
 *    If Doors of Night is in play, may also be played keyed to Grey
 *    Mountain Narrows, Iron Hills, Northern Rhovanion, and Withered
 *    Heath; and may also be played at sites in these regions."
 *
 * Base stats: strikes 2, prowess 16, body 8, kill MP 4.
 *
 * keyedTo:
 * | # | Entry                                                                                  | When                        |
 * |---|----------------------------------------------------------------------------------------|-----------------------------|
 * | 1 | siteNames: [Irerock]                                                                   | always                      |
 * | 2 | regionNames: [Grey Mountain Narrows, Iron Hills, Northern Rhovanion, Withered Heath]   | Doors of Night in play      |
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

const LEUCARUTH = 'tw-48' as CardDefinitionId;

/** MH state simulating arrival at Irerock (no DoN needed). */
function mhAtIrerock(): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Border, RegionType.Shadow, RegionType.Wilderness],
    resolvedSitePathNames: ['Withered Heath'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Irerock',
  });
}

/** MH state simulating arrival at a site in Iron Hills (with path through Iron Hills). */
function mhInIronHills(): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Iron Hills'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Iron Hill Dwarf-hold',
  });
}

describe('Leucaruth (tw-48)', () => {
  beforeEach(() => resetMint());

  // ─── Combat: 2 strikes, 16 prowess ──────────────────────────────────────

  test('combat starts with normal assignment, 2 strikes at 16/8', () => {
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
          hand: [LEUCARUTH],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhAtIrerock() };

    const leucaruthId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, leucaruthId, companyId,
      { method: 'site-name' as const, value: 'Irerock' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(16);
    expect(afterChain.combat!.creatureBody).toBe(8);
    expect(afterChain.combat!.creatureRace).toBe('dragon');

    // Defender (not attacker) picks defending character/strike assignment,
    // since Leucaruth carries no attacker-chooses-defenders effect.
    expect(viableActions(afterChain, PLAYER_1, 'assign-strike').length).toBeGreaterThan(0);
  });

  // ─── Keying: at Irerock, no DoN required ────────────────────────────────

  test('keyable at Irerock without Doors of Night', () => {
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
          hand: [LEUCARUTH],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhAtIrerock() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-name' && a.keyedBy?.value === 'Irerock';
    })).toBe(true);
  });

  // ─── Keying: regions require Doors of Night ─────────────────────────────

  test('NOT keyable to Iron Hills region without Doors of Night', () => {
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
          hand: [LEUCARUTH],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInIronHills() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    // The play-hazard entry exists but is non-viable, tagged with a keying error.
    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('keyable to Iron Hills region when Doors of Night IS in play', () => {
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
          hand: [LEUCARUTH],
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

  test('keyable at any site in Northern Rhovanion with Doors of Night (site-in-region clause)', () => {
    // Destination site is a non-Irerock site in Northern Rhovanion.
    // Engine adds destination site's region to resolvedSitePathNames, so the
    // regionNames keying entry matches.
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
          hand: [LEUCARUTH],
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
          hand: [LEUCARUTH],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    // Rhudaur wilderness path to Moria — none of Leucaruth's four regions.
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });
});
