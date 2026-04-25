/**
 * @module dm-111.test
 *
 * Card test: Stirring Bones (dm-111)
 * Type: hazard-creature
 * Race: Undead, 2 strikes, prowess 9, no body, 1 kill MP
 *
 * "Undead. Two strikes."
 *
 * No special effects — all rules are captured in structural fields
 * (race, strikes, prowess).
 *
 * Keyed to: {w}{w}{s}{d}{R}{S}
 * Playable when the site path contains ≥2 wildernesses OR ≥1 shadow OR
 * ≥1 dark, OR the destination site is ruins-and-lairs or shadow-hold.
 *
 * | # | Effect Type | Status | Notes                                   |
 * |---|-------------|--------|-----------------------------------------|
 * |   | (none)      | OK     | Undead/two-strikes: structural data only |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  makeDoubleWildernessMHState, makeShadowMHState,
  handCardId, companyIdAt,
  viableActionsForHandCard,
  playCreatureHazardAndResolve,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import type { PlayerSetup } from '../test-helpers.js';

const STIRRING_BONES = 'dm-111' as CardDefinitionId;

const BASE_PLAYERS: [PlayerSetup, PlayerSetup] = [
  { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
  { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [STIRRING_BONES], siteDeck: [RIVENDELL] },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Stirring Bones (dm-111)', () => {
  beforeEach(() => resetMint());

  test('playable when path has two wildernesses', () => {
    const state = buildTestState({ activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: BASE_PLAYERS });
    const ready = { ...state, phaseState: makeDoubleWildernessMHState() };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, STIRRING_BONES);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('playable when path has one shadow-land', () => {
    const state = buildTestState({ activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: BASE_PLAYERS });
    const ready = { ...state, phaseState: makeShadowMHState() };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, STIRRING_BONES);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('playable when path has one dark-domain', () => {
    const state = buildTestState({ activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: BASE_PLAYERS });
    const ready = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Dark],
        destinationSiteType: SiteType.DarkHold,
        destinationSiteName: 'Moria',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, STIRRING_BONES);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('not playable when path has only one wilderness and free-hold destination', () => {
    const state = buildTestState({ activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: BASE_PLAYERS });
    const ready = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Minas Tirith',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, STIRRING_BONES);
    expect(actions).toHaveLength(0);
  });

  test('not playable when path has only free or border regions', () => {
    const state = buildTestState({ activePlayer: PLAYER_1, phase: Phase.MovementHazard, players: BASE_PLAYERS });
    const ready = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Free, RegionType.Border],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Minas Tirith',
      }),
    };

    const actions = viableActionsForHandCard(ready, PLAYER_2, 'play-hazard', HAZARD_PLAYER, STIRRING_BONES);
    expect(actions).toHaveLength(0);
  });

  test('combat initiates with 2 strikes and prowess 9', () => {
    const state = buildTestState({ activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true, players: BASE_PLAYERS });
    const ready = { ...state, phaseState: makeShadowMHState() };

    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterPlay = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId,
      { method: 'region-type', value: RegionType.Shadow },
    );

    expect(afterPlay.combat).not.toBeNull();
    expect(afterPlay.combat!.strikesTotal).toBe(2);
    expect(afterPlay.combat!.strikeProwess).toBe(9);
    expect(afterPlay.combat!.attackSource.type).toBe('creature');
  });
});
