/**
 * @module tw-024.test
 *
 * Card test: Corsairs of Umbar (tw-24)
 * Type: hazard-creature
 * Effects: 0
 *
 * Text:
 *   "Men. Five strikes. May also be played keyed to Andrast, Anfalas,
 *    Belfalas, Cardolan, Enedhwaith, Harondor, Lindon, Lebennin, and
 *    Old Pûkel-land; and may also be played at Ruins & Lairs [{R}] and
 *    Shadow-holds [{S}] in these regions. May also be played at any site
 *    in Elven Shores, Eriadoran Coast, Andrast Coast, Bay of Belfalas,
 *    or Mouths of the Anduin."
 *
 * Base stats: strikes 5, prowess 9, body — (no body check), kill MP 1,
 * race men.
 *
 * keyedTo:
 * | # | Entry                                                                                       | When   |
 * |---|----------------------------------------------------------------------------------------------|--------|
 * | 1 | regionTypes: [coastal]                                                                      | always |
 * | 2 | regionNames: [Andrast, Anfalas, Belfalas, Cardolan, Enedhwaith, Harondor, Lindon, Lebennin, Old Pûkel-land] | always |
 *
 * The "R&L and Shadow-holds in these regions" clause is subsumed by entry 2
 * (regionNames match fires for any site type in that region). The "any site in
 * Elven Shores, Eriadoran Coast, Andrast Coast, Bay of Belfalas, Mouths of
 * the Anduin" clause is subsumed by entry 1 (all five are coastal regions).
 *
 * Effects: none — the card has no special abilities; all rules are captured
 * in base stats, race, and keying.
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

const CORSAIRS_OF_UMBAR = 'tw-24' as CardDefinitionId;

const NAMED_REGIONS = [
  'Andrast',
  'Anfalas',
  'Belfalas',
  'Cardolan',
  'Enedhwaith',
  'Harondor',
  'Lindon',
  'Lebennin',
  'Old Pûkel-land',
] as const;

const COASTAL_REGIONS = [
  'Elven Shores',
  'Eriadoran Coast',
  'Andrast Coast',
  'Bay of Belfalas',
  'Mouths of the Anduin',
] as const;

/** MH state with the given region name in the resolved path. */
function mhInNamedRegion(regionName: string): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: [regionName],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Some Site',
  });
}

/** MH state arriving at a coastal region. */
function mhInCoastalRegion(regionName: string): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Coastal],
    resolvedSitePathNames: [regionName],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Lond Galen',
  });
}

function baseState() {
  return buildTestState({
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
        hand: [CORSAIRS_OF_UMBAR],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Corsairs of Umbar (tw-24)', () => {
  beforeEach(() => resetMint());

  // ─── Combat stats: 5 strikes at 9 prowess, no body, Men race ─────────

  test('combat initiates with 5 strikes at 9 prowess, men race, no body', () => {
    const state = baseState();
    const ready: GameState = { ...state, phaseState: mhInCoastalRegion('Elven Shores') };

    const corsairsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, corsairsId, companyId,
      { method: 'region-type' as const, value: 'coastal' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(5);
    expect(afterChain.combat!.strikeProwess).toBe(9);
    expect(afterChain.combat!.creatureBody).toBe(null);
    expect(afterChain.combat!.creatureRace).toBe('men');
  });

  // ─── Base keying: coastal region type ────────────────────────────────

  test.each(COASTAL_REGIONS)('keyable via coastal region type when path passes through %s', (region) => {
    const state = baseState();
    const ready: GameState = { ...state, phaseState: mhInCoastalRegion(region) };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === 'coastal';
    })).toBe(true);
  });

  // ─── Named-region keying: each of the nine regions ───────────────────

  test.each(NAMED_REGIONS)('keyable via region name when path passes through %s', (region) => {
    const state = baseState();
    const ready: GameState = { ...state, phaseState: mhInNamedRegion(region) };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === region;
    })).toBe(true);
  });

  // ─── Keying rejected outside valid regions ───────────────────────────

  test('NOT keyable when path passes through an unrelated wilderness region', () => {
    const state = baseState();
    // Default wilderness path through Rhudaur — not in the nine named regions.
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });
});
