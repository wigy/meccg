/**
 * @module td-59.test
 *
 * Card test: Sand-drake (td-59)
 * Type: hazard-creature (Drake)
 *
 * Text:
 *   "Drake. Three strikes. Attacker chooses defending characters. May be
 *    played keyed to Khand and Harondor. If Doors of Night is in play, may
 *    also be played keyed to Ithilien, Nurn, and Horse Plains."
 *
 * Base stats: strikes 3, prowess 12, body — (no body check), kill MP 1.
 *
 * Effects:
 * | # | Effect Type                       | Status | Notes                            |
 * |---|-----------------------------------|--------|----------------------------------|
 * | 1 | combat-attacker-chooses-defenders | OK     | Cancel-window before assignment  |
 *
 * keyedTo:
 * | # | Entry                                              | When                        |
 * |---|----------------------------------------------------|-----------------------------|
 * | 1 | regionNames: [Khand, Harondor]                     | always                      |
 * | 2 | regionNames: [Ithilien, Nurn, Horse Plains]        | Doors of Night in play      |
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

const SAND_DRAKE = 'td-59' as CardDefinitionId;

const BASE_REGIONS = ['Khand', 'Harondor'] as const;
const DON_REGIONS = ['Ithilien', 'Nurn', 'Horse Plains'] as const;

/** MH state with the given region name in the resolved path. */
function mhInRegion(regionName: string): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: [regionName],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Some Lair',
  });
}

function donInPlay() {
  return {
    instanceId: 'don-1' as CardInstanceId,
    definitionId: DOORS_OF_NIGHT,
    status: CardStatus.Untapped,
  };
}

describe('Sand-drake (td-59)', () => {
  beforeEach(() => resetMint());

  // ─── Combat: 3 strikes, 12 prowess, attacker chooses defenders ─────────

  test('combat starts with cancel-window (attacker-chooses-defenders), 3 strikes at 12', () => {
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
          hand: [SAND_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInRegion('Khand') };

    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId,
      { method: 'region-name' as const, value: 'Khand' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // attacker-chooses-defenders: cancel window precedes attacker assignment
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(12);
    expect(afterChain.combat!.creatureBody).toBe(null);
    expect(afterChain.combat!.creatureRace).toBe('drake');
  });

  // ─── Base keying: Khand and Harondor without DoN ───────────────────────

  test.each(BASE_REGIONS)('keyable in %s without Doors of Night', (region) => {
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
          hand: [SAND_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInRegion(region) };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === region;
    })).toBe(true);
  });

  // ─── Alt keying: DoN-gated regions ─────────────────────────────────────

  test.each(DON_REGIONS)('NOT keyable in %s without Doors of Night', (region) => {
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
          hand: [SAND_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInRegion(region) };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test.each(DON_REGIONS)('keyable in %s when Doors of Night IS in play', (region) => {
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
          hand: [SAND_DRAKE],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay()],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInRegion(region) };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === region;
    })).toBe(true);
  });

  // ─── Keying is exclusively region-name (not region-type) ──────────────

  test('NOT keyable in an unrelated wilderness region even with Doors of Night', () => {
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
          hand: [SAND_DRAKE],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay()],
        },
      ],
    });
    // Rhudaur wilderness path — not in either keying list.
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
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
          hand: [SAND_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInRegion('Harondor') };

    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId,
      { method: 'region-name' as const, value: 'Harondor' },
    );

    // Defender has no assign-strike during cancel-window (attacker chooses)
    expect(viableActions(afterChain, PLAYER_1, 'assign-strike')).toHaveLength(0);

    // After defender passes the cancel-window, attacker (P2) gets assignment.
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike').length).toBeGreaterThan(0);
  });
});
