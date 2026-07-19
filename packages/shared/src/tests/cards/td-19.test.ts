/**
 * @module td-19.test
 *
 * Card test: Dunlending Raiders (td-19)
 * Type: hazard-creature (Men)
 * Effects: 0
 *
 * Text:
 *   "Men. Five strikes. Playable keyed to Enedhwaith, Cardolan, Hollin,
 *    Rhudaur, and Dunland; and may also be played at Ruins & Lairs [{R}]
 *    in these regions."
 *
 * Base stats: strikes 5, prowess 8, body — (no body check), kill MP 1,
 * race Men.
 *
 * keyedTo:
 * | # | Entry                                                              | When   |
 * |---|--------------------------------------------------------------------|--------|
 * | 1 | regionNames: [Enedhwaith, Cardolan, Hollin, Rhudaur, Dunland]      | always |
 *
 * The "may also be played at Ruins & Lairs [{R}] in these regions" clause
 * is subsumed by the region-name keying: a company moving to (or through) a
 * site in one of the five named regions traverses that region, so the plain
 * `regionNames` entry already covers ending at an R&L there. This mirrors the
 * established convention for region-keyed creatures with the same boilerplate
 * clause (le-60 Arthadan Rangers, le-78 Horse-lords, tw-24 Corsairs of Umbar,
 * tw-82 Pûkel-men).
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

const DUNLENDING_RAIDERS = 'td-19' as CardDefinitionId;

const KEYED_REGIONS = [
  'Enedhwaith',
  'Cardolan',
  'Hollin',
  'Rhudaur',
  'Dunland',
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

describe('Dunlending Raiders (td-19)', () => {
  beforeEach(() => resetMint());

  // ─── Combat stats: 5 strikes at 8 prowess, no body, Men race ──────────

  test('combat initiates with 5 strikes at 8 prowess, men race, no body', () => {
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
          hand: [DUNLENDING_RAIDERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInRegion('Cardolan') };

    const raidersId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, raidersId, companyId,
      { method: 'region-name' as const, value: 'Cardolan' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // No attacker-chooses-defenders: assignment begins on the defender.
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    // Five strikes regardless of the (smaller) defending company size.
    expect(afterChain.combat!.strikesTotal).toBe(5);
    expect(afterChain.combat!.strikeProwess).toBe(8);
    expect(afterChain.combat!.creatureBody).toBe(null);
    // The "men" data race normalizes to the singular Race enum value.
    expect(afterChain.combat!.creatureRace).toBe('man');
  });

  // ─── Keying: each of the five named regions ───────────────────────────

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
          hand: [DUNLENDING_RAIDERS],
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

  test('NOT keyable when path passes through none of the five regions', () => {
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
          hand: [DUNLENDING_RAIDERS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    // Arthedain is a wilderness region NOT among the five keyed regions, and
    // the destination is an R&L there — the R&L clause only applies inside the
    // five named regions, so this must still be rejected.
    const ready: GameState = { ...state, phaseState: mhInRegion('Arthedain') };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    // The play-hazard entry exists but is non-viable with a keying error.
    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });
});
