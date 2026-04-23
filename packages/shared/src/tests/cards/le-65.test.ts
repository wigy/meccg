/**
 * @module le-65.test
 *
 * Card test: Cave Worm (le-65)
 * Type: hazard-creature (Drake)
 * Effects: 0
 *
 * Text:
 *   "Drake. One strike. May be played keyed to Redhorn Gate, High Pass,
 *    Gap of Isen, Angmar, Gundabad, Grey Mountain Narrows, Withered
 *    Heath, Númeriador, and Iron Hills."
 *
 * Base stats: strikes 1, prowess 16, body — (no body check), kill MP 1.
 *
 * keyedTo:
 * | # | Entry                                                                                                                                | When   |
 * |---|--------------------------------------------------------------------------------------------------------------------------------------|--------|
 * | 1 | regionNames: [Redhorn Gate, High Pass, Gap of Isen, Angmar, Gundabad, Grey Mountain Narrows, Withered Heath, Númeriador, Iron Hills] | always |
 *
 * Effects: none — the card has no special abilities beyond its keying and
 * base combat stats, all of which are handled structurally by the engine.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, makeWildernessMHState,
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

const CAVE_WORM = 'le-65' as CardDefinitionId;

const KEYED_REGIONS = [
  'Redhorn Gate',
  'High Pass',
  'Gap of Isen',
  'Angmar',
  'Gundabad',
  'Grey Mountain Narrows',
  'Withered Heath',
  'Númeriador',
  'Iron Hills',
] as const;

/** MH state with the given region name in the resolved path. */
function mhInRegion(regionName: string): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: [regionName],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Some Lair',
  });
}

describe('Cave Worm (le-65)', () => {
  beforeEach(() => resetMint());

  // ─── Combat stats: 1 strike at 16 prowess, no body ────────────────────

  test('combat initiates with 1 strike at 16 prowess, drake race, no body', () => {
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
          hand: [CAVE_WORM],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInRegion('Angmar') };

    const wormId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, wormId, companyId,
      { method: 'region-name' as const, value: 'Angmar' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // No attacker-chooses-defenders: assignment begins on the defender.
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(16);
    expect(afterChain.combat!.creatureBody).toBe(null);
    expect(afterChain.combat!.creatureRace).toBe('drake');
  });

  // ─── Keying: each of the nine named regions ───────────────────────────

  test.each(KEYED_REGIONS)('keyable when path passes through %s', (region) => {
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
          hand: [CAVE_WORM],
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

  // ─── Keying: rejected in unrelated region ─────────────────────────────

  test('NOT keyable when path passes through none of the nine regions', () => {
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
          hand: [CAVE_WORM],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    // Default wilderness path — not one of the nine named regions.
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    // The play-hazard entry exists but is non-viable with a keying error.
    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  // ─── Keying is exclusively region-name (not region-type) ──────────────

  test('NOT keyable to a wilderness region not in the nine-list', () => {
    // Wilderness region type alone is not enough — the card uses named
    // regions only. Use a wilderness region name that is NOT in the nine.
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
          hand: [CAVE_WORM],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInRegion('Arthedain') };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
