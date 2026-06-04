/**
 * @module le-98.test
 *
 * Card test: Wargs (le-98)
 * Type: hazard-creature (wolves)
 * Effects: 0 (no special effects)
 *
 * Text: "Wolves. Two strikes."
 *
 * Stats: prowess 9, strikes 2, kill-marshalling-points 1
 *
 * keyedTo:
 * | # | Entry                                       | When   | Notes              |
 * |---|---------------------------------------------|--------|--------------------|
 * | 1 | regionTypes: [border, wilderness, shadow]   | always | base keying {b}{w}{s} |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  makeWildernessMHState, makeShadowMHState, makeBorderMHState,
  playCreatureHazardAndResolve, charIdAt,
  companyIdAt, viableActions, reduce,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState, PlayHazardAction } from '../../index.js';

const WARGS = 'le-98' as CardDefinitionId;

const BORDER_KEYING = { method: 'region-type' as const, value: RegionType.Border };
const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };
const SHADOW_KEYING = { method: 'region-type' as const, value: RegionType.Shadow };

describe('Wargs (le-98)', () => {
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

  // ─── Base stats ──────────────────────────────────────────────────────────

  test('initiates combat with 2 strikes at prowess 9 via wilderness keying', () => {
    const ready = { ...baseState([WARGS]), phaseState: makeWildernessMHState() };
    const wargsId = ready.players[HAZARD_PLAYER].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wargsId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(9);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  // ─── Keying ──────────────────────────────────────────────────────────────

  test('can be played keyed to a border-land region', () => {
    const ready = { ...baseState([WARGS]), phaseState: makeBorderMHState() };
    const wargsId = ready.players[HAZARD_PLAYER].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wargsId, companyId, BORDER_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(9);
  });

  test('can be played keyed to a shadow-land region', () => {
    const ready = { ...baseState([WARGS]), phaseState: makeShadowMHState() };
    const wargsId = ready.players[HAZARD_PLAYER].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wargsId, companyId, SHADOW_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(9);
  });

  test('cannot be played when path contains only free-domain regions', () => {
    const mhState: MovementHazardPhaseState = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['The Shire'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Minas Tirith',
    });
    const ready = { ...baseState([WARGS]), phaseState: mhState };
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const hazardActions = viableActions(ready, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    const wargsPlays = hazardActions.filter(
      a => a.cardInstanceId === ready.players[HAZARD_PLAYER].hand[0].instanceId,
    );
    expect(wargsPlays).toHaveLength(0);
  });

  // ─── Two strikes: first assigned, second passable ────────────────────────

  test('two strikes: first assignment accepted, second can be passed', () => {
    const ready = { ...baseState([WARGS]), phaseState: makeWildernessMHState() };
    const wargsId = ready.players[HAZARD_PLAYER].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, wargsId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);

    const aragornId = charIdAt(afterChain, RESOURCE_PLAYER);
    const r = reduce(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(r.error).toBeUndefined();
    const passActions = viableActions(r.state, PLAYER_1, 'pass');
    expect(passActions.length).toBeGreaterThan(0);
  });
});
