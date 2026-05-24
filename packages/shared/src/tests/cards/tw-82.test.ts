/**
 * @module tw-82.test
 *
 * Card test: Pûkel-men (tw-82)
 * Type: hazard-creature
 * Effects: 0 (no special effects)
 *
 * "Pûkel-creature. Two strikes. May also be played at Ruins & Lairs [{R}]
 *  sites in the following regions: Andrast, Anfalas, Anórien, Dunland,
 *  Enedhwaith, Gap of Isen, Lamedon, Old Pûkel Gap, Old Pûkel-land, and Rohan."
 *
 * Stats: prowess 11, strikes 2, kill-marshalling-points 1
 * Race: pûkel-creature
 *
 * Keying:
 *   - Base {S}{D}: shadow-hold or dark-hold destination site
 *   - Alt: any of the 10 named Pûkel regions in the site path
 *
 * Engine support:
 * | # | Feature                            | Status      | Notes                             |
 * |---|-------------------------------------|-------------|-----------------------------------|
 * | 1 | Two strikes, prowess 11             | IMPLEMENTED | structural data                   |
 * | 2 | Base keying {S}{D}: shadow/dark-hold| IMPLEMENTED | siteTypes in keyedTo              |
 * | 3 | Alt keying: named Pûkel regions     | IMPLEMENTED | regionNames in keyedTo            |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeShadowMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const PUKEL_MEN = 'tw-82' as CardDefinitionId;
const SHADOW_HOLD_KEYING = { method: 'site-type' as const, value: 'shadow-hold' };
const DARK_HOLD_KEYING = { method: 'site-type' as const, value: 'dark-hold' };
const ANDRAST_KEYING = { method: 'region-name' as const, value: 'Andrast' };
const DUNLAND_KEYING = { method: 'region-name' as const, value: 'Dunland' };

describe('Pûkel-men (tw-82)', () => {
  beforeEach(() => resetMint());

  function baseState(hand: CardDefinitionId[]) {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand, siteDeck: [RIVENDELL] },
      ],
    });
  }

  // ─── Base keying: shadow-hold ─────────────────────────────────────────────

  test('playable keyed to shadow-hold destination (base keying {S})', () => {
    const state = baseState([PUKEL_MEN]);
    const ready = { ...state, phaseState: makeShadowMHState() };
    const pukelId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, pukelId, companyId, SHADOW_HOLD_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(11);
  });

  // ─── Base keying: dark-hold ───────────────────────────────────────────────

  test('playable keyed to dark-hold destination (base keying {D})', () => {
    const state = baseState([PUKEL_MEN]);
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Mordor'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    });
    const ready = { ...state, phaseState: mhState };
    const pukelId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, pukelId, companyId, DARK_HOLD_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(11);
  });

  // ─── Alt keying: named Pûkel region ──────────────────────────────────────

  test('playable keyed to Andrast (named region alt keying)', () => {
    const state = baseState([PUKEL_MEN]);
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Andrast'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Andrast',
    });
    const ready = { ...state, phaseState: mhState };
    const pukelId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, pukelId, companyId, ANDRAST_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(11);
  });

  test('playable keyed to Dunland (named region alt keying)', () => {
    const state = baseState([PUKEL_MEN]);
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Dunland'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Isengard',
    });
    const ready = { ...state, phaseState: mhState };
    const pukelId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, pukelId, companyId, DUNLAND_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(11);
  });

  // ─── Not playable: unrelated path ────────────────────────────────────────

  test('NOT playable on wilderness path to non-Pûkel R&L site', () => {
    const state = baseState([PUKEL_MEN]);
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Weathertop',
    });
    const ready = { ...state, phaseState: mhState };
    const pukelId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && (a.action).cardInstanceId === pukelId
        && (a.action).targetCompanyId === companyId)
      .filter(a => a.viable);
    expect(viable).toHaveLength(0);
  });

  test('NOT playable on free-domain path to free-hold', () => {
    const state = baseState([PUKEL_MEN]);
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Shire'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Rivendell',
    });
    const ready = { ...state, phaseState: mhState };
    const pukelId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && (a.action).cardInstanceId === pukelId
        && (a.action).targetCompanyId === companyId)
      .filter(a => a.viable);
    expect(viable).toHaveLength(0);
  });
});
