/**
 * @module td-32.test
 *
 * Card test: Ice-drake (td-32)
 * Type: hazard-creature (Drake)
 * Effects: 0
 *
 * Text:
 *   "Drake. Two strikes. May be played keyed to Elven Shores, Forochel,
 *    Angmar, Gundabad, Grey Mountain Narrows, and Withered Heath."
 *
 * Base stats: strikes 2, prowess 15, body — (no body check), kill MP 1,
 * race Drake.
 *
 * keyedTo:
 * | # | Entry                                                                    | When   |
 * |---|--------------------------------------------------------------------------|--------|
 * | 1 | regionNames: [Elven Shores, Forochel, Angmar, Gundabad,                  | always |
 * |   |               Grey Mountain Narrows, Withered Heath]                     |        |
 *
 * Unlike td-19 there is no additional "may also be played at R&L in these
 * regions" clause — the Ice-drake is a plain region-name-keyed creature.
 * A company whose resolved movement path passes through any one of the six
 * named regions may face it. All of this is handled structurally by the
 * engine (mh-hazard-play.ts region-name keying); the card carries no special
 * abilities beyond its keying and base combat stats.
 *
 * Effects: none.
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

const ICE_DRAKE = 'td-32' as CardDefinitionId;

const KEYED_REGIONS = [
  'Elven Shores',
  'Forochel',
  'Angmar',
  'Gundabad',
  'Grey Mountain Narrows',
  'Withered Heath',
] as const;

/** MH state with the given region name in the resolved path, ending at an R&L. */
function mhInRegion(regionName: string): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: [regionName],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Some Lair',
  });
}

describe('Ice-drake (td-32)', () => {
  beforeEach(() => resetMint());

  // ─── Combat stats: 2 strikes at 15 prowess, no body, Drake race ───────

  test('combat initiates with 2 strikes at 15 prowess, drake race, no body', () => {
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
          hand: [ICE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInRegion('Angmar') };

    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId,
      { method: 'region-name' as const, value: 'Angmar' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // No attacker-chooses-defenders: assignment begins on the defender.
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    // Two strikes regardless of the (smaller) defending company size.
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(15);
    expect(afterChain.combat!.creatureBody).toBe(null);
    expect(afterChain.combat!.creatureRace).toBe('drake');
  });

  // ─── Keying: each of the six named regions ────────────────────────────

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
          hand: [ICE_DRAKE],
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

  // ─── Keying: rejected in an unrelated region ──────────────────────────

  test('NOT keyable when path passes through none of the six regions', () => {
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
          hand: [ICE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    // Cardolan is a wilderness region NOT among the six keyed regions.
    const ready: GameState = { ...state, phaseState: mhInRegion('Cardolan') };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    // The play-hazard entry exists but is non-viable with a keying error.
    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });
});
