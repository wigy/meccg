/**
 * @module tw-45.test
 *
 * Card test: Huorn (tw-45)
 * Type: hazard-creature
 * Race: Awakened Plant. One strike at prowess 10 (body: none).
 *
 * Card text:
 *   "Awakened Plant. One strike. May also be played at Drúadan Forest, Old
 *    Forest, and Wellinghall. May also be played keyed to Heart of Mirkwood,
 *    Southern Mirkwood, Western Mirkwood, and Woodland Realm; and may also be
 *    played at Ruins & Lairs [{R}] and Shadow-holds [{S}] in these regions."
 *
 * Keying (canonical playable: {w}):
 *   - Base: one Wilderness {w} in the site path
 *   - Alt: named sites Drúadan Forest, Old Forest, Wellinghall
 *   - Alt: named regions Heart of Mirkwood, Southern Mirkwood, Western
 *     Mirkwood, Woodland Realm (covers R&L/Shadow-hold in those regions too,
 *     since region-name keying matches regardless of the destination's site
 *     type — the same precedent used by Giant Spiders le-75)
 *
 * Engine support:
 * | # | Feature                          | Status      | Notes                          |
 * |---|----------------------------------|-------------|---------------------------------|
 * | 1 | One strike, prowess 10           | IMPLEMENTED | structural data                 |
 * | 2 | Keying: {w} single wilderness    | IMPLEMENTED | regionTypes: [wilderness]        |
 * | 3 | Keying: named sites              | IMPLEMENTED | siteNames in keyedTo             |
 * | 4 | Keying: named Mirkwood regions   | IMPLEMENTED | regionNames in keyedTo           |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve, runCreatureCombat,
  handCardId, companyIdAt, findCharInstanceId,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const HUORN = 'tw-45' as CardDefinitionId;
const WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };
const SITE_NAME_KEYING = { method: 'site-name' as const, value: 'Old Forest' };
const REGION_NAME_KEYING = { method: 'region-name' as const, value: 'Woodland Realm' };

function setupState() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [HUORN], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Huorn (tw-45)', () => {
  beforeEach(() => resetMint());

  // ─── Keying ───────────────────────────────────────────────────────────────

  test('playable keyed to a single Wilderness in the path', () => {
    const state = setupState();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Fangorn'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const huornId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === huornId && a.viable);
    expect(viable.length).toBeGreaterThan(0);
  });

  test('NOT playable on a path/destination matching none of its keying entries', () => {
    const state = setupState();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Eriador'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const ready = { ...state, phaseState: mhState };
    const huornId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === huornId && a.viable);
    expect(viable).toHaveLength(0);
  });

  test('playable keyed to the named site Old Forest, even off a non-Wilderness path', () => {
    const state = setupState();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Cardolan'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Old Forest',
    });
    const ready = { ...state, phaseState: mhState };
    const huornId = handCardId(ready, HAZARD_PLAYER);
    const actions = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === huornId && a.viable);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('playable keyed to the named region Woodland Realm, even off a non-Wilderness path', () => {
    const state = setupState();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Woodland Realm'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Dol Guldur',
    });
    const ready = { ...state, phaseState: mhState };
    const huornId = handCardId(ready, HAZARD_PLAYER);
    const actions = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === huornId && a.viable);
    expect(actions.length).toBeGreaterThan(0);
  });

  // ─── Combat initiates ─────────────────────────────────────────────────────

  test('combat initiates with 1 strike and prowess 10 (region-type keying)', () => {
    const state = setupState();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Fangorn'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const huornId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, huornId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(10);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  test('combat initiates when keyed via the named site Old Forest', () => {
    const state = setupState();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Cardolan'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Old Forest',
    });
    const ready = { ...state, phaseState: mhState };
    const huornId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, huornId, companyId, SITE_NAME_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(10);
  });

  test('combat initiates when keyed via the named region Woodland Realm', () => {
    const state = setupState();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Woodland Realm'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Dol Guldur',
    });
    const ready = { ...state, phaseState: mhState };
    const huornId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, huornId, companyId, REGION_NAME_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(10);
  });

  test('character wounded by Huorn resolves through the standard body check', () => {
    const state = setupState();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Fangorn'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const huornId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, huornId, companyId, WILDERNESS_KEYING);

    // Aragorn: prowess 6, body 9. Huorn prowess 10.
    // Strike roll 2: 2+(6-10)=-2 < 0 → wounded. Body check roll 8 < 9 → survives.
    const afterWound = runCreatureCombat(afterChain, ARAGORN, 2, 8);
    expect(afterWound.combat).toBeNull();
    const aragornId = findCharInstanceId(afterWound, RESOURCE_PLAYER, ARAGORN);
    expect(afterWound.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();
  });
});
