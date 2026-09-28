/**
 * @module le-86.test
 *
 * Card test: Orc-warband (le-86)
 * Type: hazard-creature (orc)
 * Effects: 1 (stat-modifier: +3 prowess when company.facedRaces includes "orc")
 *
 * "Orcs. Five strikes. If played on a company that has already faced an
 *  Orc attack this turn, Orc-warband receives +3 prowess."
 *
 * Base stats: 5 strikes, prowess 4, no body, 1 kill MP. Keyed to
 * Wilderness [{w}], Shadow-land [{s}], or Dark-domain [{d}], or Ruins &
 * Lairs [{R}] / Shadow-hold [{S}] / Dark-hold [{D}] (playable
 * "{w}{s}{d}{R}{S}{D}"). Lidless Eye reprint of tw-076.
 *
 * This tests:
 * 1. Base attack: 5 strikes at prowess 4 with no prior Orc attack.
 * 2. +3 prowess (total 7) once the company has already faced an Orc attack.
 * 3. A prior non-Orc attack (Barrow-wight, undead) grants no bonus.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  ORC_LIEUTENANT, BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeShadowMHState,
  playCreatureHazardAndResolve, runCreatureCombat,
  handCardId, companyIdAt, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Race, ORC_WARBAND_LE } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const SHADOW_KEYING = { method: 'region-type' as const, value: 'shadow' };

function readyState(hand: readonly CardDefinitionId[]) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [...hand], siteDeck: [RIVENDELL] },
    ],
  });
  return { ...state, phaseState: makeShadowMHState() };
}

describe('Orc-warband (le-86)', () => {
  beforeEach(() => resetMint());

  test('5 strikes at base prowess 4 when the company has not faced an Orc attack', () => {
    const ready = readyState([ORC_WARBAND_LE]);
    const warbandId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, warbandId, companyId, SHADOW_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.creatureRace).toBe('orc');
    expect(afterChain.combat!.strikesTotal).toBe(5);
    expect(afterChain.combat!.strikeProwess).toBe(4);
  });

  test('+3 prowess (total 7) when the company has already faced an Orc attack this turn', () => {
    const ready = readyState([ORC_LIEUTENANT, ORC_WARBAND_LE]);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // Orc-lieutenant attacks first and is defeated.
    const orcLtId = handCardId(ready, HAZARD_PLAYER, 0);
    const afterOrcLt = playCreatureHazardAndResolve(ready, PLAYER_2, orcLtId, companyId, SHADOW_KEYING);
    const afterCombat = runCreatureCombat(afterOrcLt, ARAGORN, 12, null);
    expect(afterCombat.combat).toBeNull();
    expect(afterCombat.players[RESOURCE_PLAYER].companies[0].facedHazardRaces).toContain(Race.Orc);

    const warbandId = handCardId(afterCombat, HAZARD_PLAYER, 0);
    const afterWarband = playCreatureHazardAndResolve(afterCombat, PLAYER_2, warbandId, companyId, SHADOW_KEYING);

    expect(afterWarband.combat).not.toBeNull();
    expect(afterWarband.combat!.strikesTotal).toBe(5);
    expect(afterWarband.combat!.strikeProwess).toBe(7);
  });

  test('no bonus when the company has only faced a non-Orc attack this turn', () => {
    const ready = readyState([BARROW_WIGHT, ORC_WARBAND_LE]);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // Barrow-wight (undead) attacks first and is defeated.
    const wightId = handCardId(ready, HAZARD_PLAYER, 0);
    const afterWight = playCreatureHazardAndResolve(ready, PLAYER_2, wightId, companyId, SHADOW_KEYING);
    const afterCombat = runCreatureCombat(afterWight, ARAGORN, 12, null);
    expect(afterCombat.combat).toBeNull();
    expect(afterCombat.players[RESOURCE_PLAYER].companies[0].facedHazardRaces).not.toContain(Race.Orc);

    const warbandId = handCardId(afterCombat, HAZARD_PLAYER, 0);
    const afterWarband = playCreatureHazardAndResolve(afterCombat, PLAYER_2, warbandId, companyId, SHADOW_KEYING);

    expect(afterWarband.combat).not.toBeNull();
    expect(afterWarband.combat!.strikeProwess).toBe(4);
  });
});
