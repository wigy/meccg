/**
 * @module le-100.test
 *
 * Card test: Wild Trolls (le-100)
 * Type: hazard-creature (trolls)
 * Effects: 0 (no special effects)
 *
 * Text: "Trolls. Two strikes."
 *
 * Stats: prowess 10, strikes 2, body none, kill-marshalling-points 1.
 *
 * keyedTo (from playable = {w}{w}{R}):
 * | # | Entry                                                  | When   | Notes                         |
 * |---|---------------------------------------------------------|--------|--------------------------------|
 * | 1 | regionTypes: [wilderness, wilderness] OR siteTypes: [ruins-and-lairs] | always | base keying {w}{w}{R} |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  findCharInstanceId,
  playCreatureHazardAndResolve, handCardId,
  companyIdAt, viableActions, dispatch, expectCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState, PlayHazardAction } from '../../index.js';

const WILD_TROLLS = 'le-100' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };
const RUINS_AND_LAIRS_KEYING = { method: 'site-type' as const, value: SiteType.RuinsAndLairs };

function baseState(hand: CardDefinitionId[]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand, siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Wild Trolls (le-100)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats ──────────────────────────────────────────────────────────

  test('initiates combat with 2 strikes at prowess 10 via double-wilderness keying', () => {
    const doubleWildernessMH = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Fangorn', 'Redhorn Gate'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Dol Guldur',
    });
    const ready = { ...baseState([WILD_TROLLS]), phaseState: doubleWildernessMH };
    const trollsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, trollsId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(10);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  // ─── Keying: site type alternative ────────────────────────────────────────

  test('playable keyed to a ruins-and-lairs destination with no wilderness in path', () => {
    const ruinsMH = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...baseState([WILD_TROLLS]), phaseState: ruinsMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === RUINS_AND_LAIRS_KEYING.method && a.keyedBy?.value === RUINS_AND_LAIRS_KEYING.value;
    })).toBe(true);
  });

  // ─── Keying: single wilderness alone is not enough ────────────────────────

  test('cannot be played when path has only a single wilderness and destination is not ruins-and-lairs', () => {
    const singleWildernessMH: MovementHazardPhaseState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Fangorn'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Minas Tirith',
    });
    const ready = { ...baseState([WILD_TROLLS]), phaseState: singleWildernessMH };
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const hazardActions = viableActions(ready, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    const trollsPlays = hazardActions.filter(
      a => a.cardInstanceId === ready.players[HAZARD_PLAYER].hand[0].instanceId,
    );
    expect(trollsPlays).toHaveLength(0);
  });

  // ─── Two strikes: combat resolution ───────────────────────────────────────

  test('both characters defeat Wild Trolls with high strike rolls', () => {
    const doubleWildernessMH = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Fangorn', 'Redhorn Gate'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Dol Guldur',
    });
    const ready = { ...baseState([WILD_TROLLS]), phaseState: doubleWildernessMH };
    const trollsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, trollsId, companyId, WILDERNESS_KEYING);

    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    let current = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    current = dispatch(current, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });

    const orderActions = viableActions(current, PLAYER_1, 'choose-strike-order');
    if (orderActions.length > 0) {
      current = dispatch(current, orderActions[0].action);
    }
    let resolveActions = viableActions({ ...current, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    current = dispatch({ ...current, cheatRollTotal: 12 }, resolveActions[0].action);

    resolveActions = viableActions({ ...current, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    if (resolveActions.length > 0) {
      current = dispatch({ ...current, cheatRollTotal: 12 }, resolveActions[0].action);
    }

    expect(current.combat).toBeNull();
    expectCharStatus(current, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expectCharStatus(current, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);
  });

  test('character wounded by Wild Trolls survives body check', () => {
    const doubleWildernessMH = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Fangorn', 'Redhorn Gate'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Dol Guldur',
    });
    const ready = { ...baseState([WILD_TROLLS]), phaseState: doubleWildernessMH };
    const trollsId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, trollsId, companyId, WILDERNESS_KEYING);

    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    let current = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    current = dispatch(current, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });

    const orderActions = viableActions(current, PLAYER_1, 'choose-strike-order');
    if (orderActions.length > 0) {
      const aragornOrder = orderActions.find(a => 'characterId' in a.action && a.action.characterId === aragornId);
      current = dispatch(current, (aragornOrder ?? orderActions[0]).action);
    }

    // Low roll → Aragorn wounded
    let resolveActions = viableActions({ ...current, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    current = dispatch({ ...current, cheatRollTotal: 2 }, resolveActions[0].action);

    // Body check: roll 5 vs body 9 → survives wounded
    if (current.combat?.phase === 'body-check') {
      const bodyActions = viableActions(current, PLAYER_2, 'body-check-roll');
      expect(bodyActions.length).toBeGreaterThan(0);
      current = dispatch({ ...current, cheatRollTotal: 5 }, bodyActions[0].action);
    }

    // High roll → Legolas wins
    resolveActions = viableActions({ ...current, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    if (resolveActions.length > 0) {
      current = dispatch({ ...current, cheatRollTotal: 12 }, resolveActions[0].action);
    }

    expect(current.combat).toBeNull();
    expectCharStatus(current, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
    expectCharStatus(current, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);
  });
});
