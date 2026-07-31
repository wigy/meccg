/**
 * @module tw-26.test
 *
 * Card test: Daelomin (tw-26)
 * Type: hazard-creature (Dragon)
 * Effects: 1
 *
 * Text:
 *   "Unique. May be played at Dancing Spire. Dragon. Three strikes.
 *    Attacker chooses defending characters. If Doors of Night is in play,
 *    may also be played keyed to Grey Mountain Narrows, Iron Hills,
 *    Northern Rhovanion, and Withered Heath; and may also be played at
 *    sites in these regions."
 *
 * Base stats: strikes 3, prowess 13, body 8, kill MP 4.
 *
 * Effects:
 * | # | Effect Type                      | Status | Notes                            |
 * |---|----------------------------------|--------|----------------------------------|
 * | 1 | combat-attacker-chooses-defenders| OK     | Cancel-window before assignment  |
 *
 * keyedTo (tw-90 Smaug shape):
 * | # | Entry                                                                                 | When                        |
 * |---|----------------------------------------------------------------------------------------|-----------------------------|
 * | 1 | siteNames: [Dancing Spire]                                                            | always                      |
 * | 2 | regionNames: [Grey Mountain Narrows, Iron Hills, Northern Rhovanion, Withered Heath]  | Doors of Night in play      |
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
  handCardId, companyIdAt, dispatch,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, RegionType, SiteType, CardStatus,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const DAELOMIN = 'tw-26' as CardDefinitionId;

/** MH state simulating arrival at Dancing Spire (no DoN needed). */
function mhAtDancingSpire(): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Border, RegionType.Shadow, RegionType.Wilderness],
    resolvedSitePathNames: ['Withered Heath'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Dancing Spire',
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

describe('Daelomin (tw-26)', () => {
  beforeEach(() => resetMint());

  // ─── Combat: 3 strikes, 13 prowess, attacker chooses defenders ─────────

  test('combat starts with cancel-window (attacker-chooses-defenders), 3 strikes at 13', () => {
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
          hand: [DAELOMIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhAtDancingSpire() };

    const daelominId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, daelominId, companyId,
      { method: 'site-name' as const, value: 'Dancing Spire' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // attacker-chooses-defenders: cancel window precedes attacker assignment
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(13);
    expect(afterChain.combat!.creatureBody).toBe(8);
    expect(afterChain.combat!.creatureRace).toBe('dragon');
  });

  // ─── Keying: at Dancing Spire, no DoN required ──────────────────────────

  test('keyable at Dancing Spire without Doors of Night', () => {
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
          hand: [DAELOMIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhAtDancingSpire() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-name' && a.keyedBy?.value === 'Dancing Spire';
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
          hand: [DAELOMIN],
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
          hand: [DAELOMIN],
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
    // Destination site is a non-Dancing-Spire site in Northern Rhovanion.
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
          hand: [DAELOMIN],
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
          hand: [DAELOMIN],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    // Rhudaur wilderness path to Moria — none of Daelomin's four regions.
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  // ─── Attacker picks defenders (verifies effect wired into combat) ──────

  test('attacker gets assign-strike actions after cancel-window pass', () => {
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
          hand: [DAELOMIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhAtDancingSpire() };

    const daelominId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, daelominId, companyId,
      { method: 'site-name' as const, value: 'Dancing Spire' },
    );

    // Defender has no assign-strike during cancel-window (attacker chooses)
    expect(viableActions(afterChain, PLAYER_1, 'assign-strike')).toHaveLength(0);

    // After defender passes the cancel-window, attacker (P2) gets assignment.
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike').length).toBeGreaterThan(0);
  });
});
