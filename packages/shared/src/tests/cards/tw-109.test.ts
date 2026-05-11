/**
 * @module tw-109.test
 *
 * Card test: Wargs (tw-109)
 * Type: hazard-creature
 * Effects: 0 (no special effects)
 *
 * "Wolves. Two strikes."
 *
 * Stats: prowess 9, strikes 2, kill-marshalling-points 1
 * Keyed to: border-land {b}, wilderness {w}, shadow-land {s}
 * Race: wolves
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, reduce,
  makeWildernessMHState, makeShadowMHState,
  playCreatureHazardAndResolve, charIdAt,
  companyIdAt, viableActions, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState, PlayHazardAction } from '../../index.js';

const WARGS = 'tw-109' as CardDefinitionId;

const BORDER_KEYING = { method: 'region-type' as const, value: 'border' };
const WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };
const SHADOW_KEYING = { method: 'region-type' as const, value: 'shadow' };

describe('Wargs (tw-109)', () => {
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

  test('initiates combat with 2 strikes and prowess 9 via wilderness keying', () => {
    const state = baseState([WARGS]);
    const mhState = makeWildernessMHState();
    const ready = { ...state, phaseState: mhState };

    const wargsId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wargsId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(9);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  test('can be played keyed to a border-land region', () => {
    const state = baseState([WARGS]);
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Enedhwaith'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const wargsId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wargsId, companyId, BORDER_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(9);
  });

  test('can be played keyed to a shadow-land region', () => {
    const state = baseState([WARGS]);
    const mhState = makeShadowMHState();
    const ready = { ...state, phaseState: mhState };

    const wargsId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wargsId, companyId, SHADOW_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(9);
  });

  test('cannot be played when path contains only free-domain regions', () => {
    const state = baseState([WARGS]);
    const mhState: MovementHazardPhaseState = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Shire'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Minas Tirith',
    });
    const ready = { ...state, phaseState: mhState };

    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const hazardActions = viableActions(ready, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    const wargsPlays = hazardActions.filter(
      a => a.cardInstanceId === ready.players[HAZARD_PLAYER].hand[0].instanceId,
    );
    expect(wargsPlays).toHaveLength(0);
  });

  test('two strikes: first assignment accepted, second can be passed', () => {
    // Wargs has 2 strikes. With only one character in the company,
    // the defender assigns the first strike then may pass the second.
    const state = baseState([WARGS]);
    const mhState = makeWildernessMHState();
    const ready = { ...state, phaseState: mhState };

    const wargsId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wargsId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);

    // Assign first strike to Aragorn
    const aragornId = charIdAt(afterChain, RESOURCE_PLAYER);
    const r = reduce(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(r.error).toBeUndefined();
    // One strike assigned, one remaining — pass should be available
    const passActions = viableActions(r.state, PLAYER_1, 'pass');
    expect(passActions.length).toBeGreaterThan(0);
  });
});
