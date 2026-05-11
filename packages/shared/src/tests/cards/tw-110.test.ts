/**
 * @module tw-110.test
 *
 * Card test: Watcher in the Water (tw-110)
 * Type: hazard-creature
 * Race: Animals. One strike per character at prowess 8.
 *
 * Card text:
 *   "Animal. Each character in the company faces one strike.
 *    May also be played at Moria."
 *
 * Base stats: strikes 1/each (runtime = company size), prowess 8,
 *   body — (no body check), kill MP 1.
 *
 * Keying (playable: {w}{w}{c}):
 * | # | Entry                         | When   |
 * |---|-------------------------------|--------|
 * | 1 | regionTypes: [wilderness × 2] | always |
 * | 2 | regionTypes: [coastal]        | always |
 * | 3 | siteNames: [Moria]            | always |
 *
 * Effects:
 * | # | Effect Type                     | Status | Notes                                    |
 * |---|---------------------------------|--------|------------------------------------------|
 * | 1 | combat-one-strike-per-character | OK     | strikesTotal = company.characters.length |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, GIMLI, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeDoubleWildernessMHState, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const WATCHER_IN_THE_WATER = 'tw-110' as CardDefinitionId;
const DOUBLE_WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };
const COASTAL_KEYING = { method: 'region-type' as const, value: RegionType.Coastal };
const MORIA_SITE_KEYING = { method: 'site-name' as const, value: 'Moria' };

function baseState(characters: CardDefinitionId[] = [ARAGORN, LEGOLAS]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [WATCHER_IN_THE_WATER], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Watcher in the Water (tw-110)', () => {
  beforeEach(() => resetMint());

  // ─── Keying: double-wilderness (base {w}{w}) ──────────────────────────

  test('playable keyed to double-wilderness path', () => {
    const ready: GameState = { ...baseState(), phaseState: makeDoubleWildernessMHState() };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const plays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId === watcherId && a.viable);
    expect(plays.length).toBeGreaterThan(0);
  });

  test('NOT playable on single-wilderness path to non-Moria site', () => {
    const mhSingle = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Mount Doom',
    });
    const ready: GameState = { ...baseState(), phaseState: mhSingle };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId === watcherId && a.viable);
    expect(viable).toHaveLength(0);
  });

  // ─── Keying: coastal-sea (base {c}) ──────────────────────────────────

  test('playable keyed to coastal region', () => {
    const mhCoastal = makeMHState({
      resolvedSitePath: [RegionType.Coastal],
      resolvedSitePathNames: ['Elven Shores'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Lond Galen',
    });
    const ready: GameState = { ...baseState(), phaseState: mhCoastal };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const plays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => {
        if (a.action.type !== 'play-hazard') return false;
        const act = a.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
        return act.cardInstanceId === watcherId && act.keyedBy?.value === 'coastal' && a.viable;
      });
    expect(plays.length).toBeGreaterThan(0);
  });

  // ─── Keying: named site Moria ─────────────────────────────────────────

  test('playable keyed to Moria (named site)', () => {
    const mhToMoria = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Udûn'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...baseState(), phaseState: mhToMoria };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const plays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => {
        if (a.action.type !== 'play-hazard') return false;
        const act = a.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
        return act.cardInstanceId === watcherId && act.keyedBy?.method === 'site-name' && act.keyedBy?.value === 'Moria' && a.viable;
      });
    expect(plays.length).toBeGreaterThan(0);
  });

  // ─── Combat: "Each character in the company faces one strike" ─────────

  test('1-character company: strikesTotal = 1', () => {
    const ready: GameState = { ...baseState([ARAGORN]), phaseState: makeDoubleWildernessMHState() };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, watcherId, companyId, DOUBLE_WILDERNESS_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(8);
  });

  test('2-character company: strikesTotal = 2', () => {
    const ready: GameState = { ...baseState([ARAGORN, BILBO]), phaseState: makeDoubleWildernessMHState() };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, watcherId, companyId, DOUBLE_WILDERNESS_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(8);
  });

  test('3-character company: strikesTotal = 3', () => {
    const ready: GameState = { ...baseState([ARAGORN, BILBO, GIMLI]), phaseState: makeDoubleWildernessMHState() };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, watcherId, companyId, DOUBLE_WILDERNESS_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(8);
  });

  test('combat initiates from coastal keying with correct strikes', () => {
    const mhCoastal = makeMHState({
      resolvedSitePath: [RegionType.Coastal],
      resolvedSitePathNames: ['Elven Shores'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Lond Galen',
    });
    const ready: GameState = { ...baseState([ARAGORN, LEGOLAS]), phaseState: mhCoastal };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, watcherId, companyId, COASTAL_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(8);
  });

  test('combat initiates from Moria site-name keying', () => {
    const mhToMoria = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Udûn'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...baseState([ARAGORN, LEGOLAS]), phaseState: mhToMoria };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, watcherId, companyId, MORIA_SITE_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(8);
  });
});
