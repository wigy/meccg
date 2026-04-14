/**
 * @module tw-076.test
 *
 * Card test: Orc-warband (tw-076)
 * Type: hazard-creature
 * Effects: 1 (stat-modifier: +3 prowess when company already faced an Orc attack)
 *
 * "Orcs. Five strikes. If played on a company that has already faced an
 *  Orc attack this turn, Orc-warband receives +3 prowess."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  ORC_WARBAND, ORC_LIEUTENANT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  pool,
  playCreatureHazardAndResolve, runCreatureCombat,
  handCardId, companyIdAt,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CreatureCard, MovementHazardPhaseState } from '../../index.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const SHADOW_KEYING = { method: 'region-type' as const, value: 'shadow' };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Orc-warband (tw-076)', () => {
  beforeEach(() => resetMint());

  test('card definition has correct base stats and prowess-bonus effect', () => {
    const def = pool[ORC_WARBAND as string] as CreatureCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-creature');
    expect(def.id).toBe('tw-076');
    expect(def.name).toBe('Orc-warband');
    expect(def.strikes).toBe(5);
    expect(def.prowess).toBe(4);
    expect(def.body).toBeNull();
    expect(def.unique).toBe(false);
    expect(def.race).toBe('orc');
    expect(def.killMarshallingPoints).toBe(1);
    expect(def.effects).toBeDefined();
    expect(def.effects).toHaveLength(1);
    expect(def.effects![0].type).toBe('stat-modifier');
  });

  test('keyed to wilderness, shadow, and dark regions with ruins-and-lairs, shadow-hold, and dark-hold sites', () => {
    const def = pool[ORC_WARBAND as string] as CreatureCard;
    expect(def.keyedTo).toBeDefined();
    expect(def.keyedTo).toHaveLength(1);
    const keying = def.keyedTo[0];
    expect(keying.regionTypes).toEqual(['wilderness', 'shadow', 'dark']);
    expect(keying.siteTypes).toEqual(['ruins-and-lairs', 'shadow-hold', 'dark-hold']);
  });

  test('base prowess is 4 when no prior Orc attack this turn', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [ORC_WARBAND], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const warbandId = handCardId(ready, 1);
    const companyId = companyIdAt(ready, 0);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, warbandId, companyId, SHADOW_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(5);
    expect(afterChain.combat!.strikeProwess).toBe(4);
  });

  test('prowess is 7 when company already faced an Orc attack this turn', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [ORC_LIEUTENANT, ORC_WARBAND], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const orcLtId = handCardId(ready, 1, 0);
    const warbandId = handCardId(ready, 1, 1);
    const companyId = companyIdAt(ready, 0);

    // Play Orc-lieutenant first (1 strike) — high roll so Aragorn wins
    const afterOrcLt = playCreatureHazardAndResolve(ready, PLAYER_2, orcLtId, companyId, SHADOW_KEYING);
    const afterCombat = runCreatureCombat(afterOrcLt, ARAGORN, 12, null);
    expect(afterCombat.combat).toBeNull();

    // Verify the Orc hazard is recorded in hazardsEncountered
    const mhAfter = afterCombat.phaseState as MovementHazardPhaseState;
    expect(mhAfter.hazardsEncountered).toContain('Orc-lieutenant');

    // Play Orc-warband — should get +3 prowess bonus (4 + 3 = 7)
    const afterWarband = playCreatureHazardAndResolve(afterCombat, PLAYER_2, warbandId, companyId, SHADOW_KEYING);

    expect(afterWarband.combat).not.toBeNull();
    expect(afterWarband.combat!.strikesTotal).toBe(5);
    expect(afterWarband.combat!.strikeProwess).toBe(7);
  });

  test('hazardsEncountered tracks Orc-lieutenant after combat finalization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [ORC_LIEUTENANT], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const orcLtId = handCardId(ready, 1);
    const companyId = companyIdAt(ready, 0);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, orcLtId, companyId, SHADOW_KEYING);
    const afterCombat = runCreatureCombat(afterChain, ARAGORN, 12, null);
    expect(afterCombat.combat).toBeNull();

    const mhAfter = afterCombat.phaseState as MovementHazardPhaseState;
    expect(mhAfter.hazardsEncountered).toContain('Orc-lieutenant');
  });
});
