/**
 * @module tw-112.test
 *
 * Card test: William (Wuluag) (tw-112)
 * Type: hazard-creature
 * Effects: 1 (on-event: character-wounded-by-self -> discard non-special items,
 *   conditional on company having faced Bert or Tom this turn)
 *
 * "Unique. Troll. One strike. If played against a company that faced
 *  'Bert' or 'Tom' this turn, each character wounded by 'William'
 *  discards all non-special items he bears."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  BERT_BURAT, TOM_TUMA, WILLIAM_WULUAG,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve, runCreatureCombat,
  companyIdAt, expectCharItemCount, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { MovementHazardPhaseState } from '../../index.js';

// --- Constants ---------------------------------------------------------------

const WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };
const SHADOW_KEYING = { method: 'region-type' as const, value: 'shadow' };

// --- Tests -------------------------------------------------------------------

describe('William (Wuluag) (tw-112)', () => {
  beforeEach(() => resetMint());


  test('combat initiates with 1 strike and 11 prowess', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILLIAM_WULUAG], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const williamId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, williamId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(11);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  test('wounded character does NOT discard items when company has not faced Bert or Tom', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILLIAM_WULUAG], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const williamId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, williamId, companyId, WILDERNESS_KEYING);

    const afterWound = runCreatureCombat(afterChain, ARAGORN, 2, 5);
    expect(afterWound.combat).toBeNull();

    expectCharItemCount(afterWound, RESOURCE_PLAYER, ARAGORN, 2);
    expect(afterWound.pendingResolutions).toHaveLength(0);
  });

  test('wounded character discards non-special items when company already faced Bert', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BERT_BURAT, WILLIAM_WULUAG], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhudaur', 'Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const bertId = ready.players[1].hand[0].instanceId;
    const williamId = ready.players[1].hand[1].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterBert = playCreatureHazardAndResolve(ready, PLAYER_2, bertId, companyId, SHADOW_KEYING);
    const afterBertCombat = runCreatureCombat(afterBert, ARAGORN, 12, null);
    expect(afterBertCombat.combat).toBeNull();

    const mhAfterBert = afterBertCombat.phaseState as MovementHazardPhaseState;
    expect(mhAfterBert.hazardsEncountered).toContain('Bert (Burat)');

    const afterWilliam = playCreatureHazardAndResolve(afterBertCombat, PLAYER_2, williamId, companyId, WILDERNESS_KEYING);
    const afterWound = runCreatureCombat(afterWilliam, ARAGORN, 2, 5);
    expect(afterWound.combat).toBeNull();

    expectCharItemCount(afterWound, RESOURCE_PLAYER, ARAGORN, 0);

    const discardDefIds = afterWound.players[0].discardPile.map(c => c.definitionId);
    expect(discardDefIds).toContain(GLAMDRING);
    expect(discardDefIds).toContain(DAGGER_OF_WESTERNESSE);
  });

  test('wounded character discards non-special items when company already faced Tom', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TOM_TUMA, WILLIAM_WULUAG], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhudaur', 'Old Forest', 'Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const tomId = ready.players[1].hand[0].instanceId;
    const williamId = ready.players[1].hand[1].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterTom = playCreatureHazardAndResolve(ready, PLAYER_2, tomId, companyId, WILDERNESS_KEYING);
    const afterTomCombat = runCreatureCombat(afterTom, ARAGORN, 12, null);

    const mhAfterTom = afterTomCombat.phaseState as MovementHazardPhaseState;
    expect(mhAfterTom.hazardsEncountered).toContain('Tom (Tuma)');

    const afterWilliam = playCreatureHazardAndResolve(afterTomCombat, PLAYER_2, williamId, companyId, WILDERNESS_KEYING);
    const afterWound = runCreatureCombat(afterWilliam, ARAGORN, 2, 5);

    expectCharItemCount(afterWound, RESOURCE_PLAYER, ARAGORN, 0);
  });

  test('character that defeats William does not lose items even when Bert was faced', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BERT_BURAT, WILLIAM_WULUAG], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhudaur', 'Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const bertId = ready.players[1].hand[0].instanceId;
    const williamId = ready.players[1].hand[1].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterBert = playCreatureHazardAndResolve(ready, PLAYER_2, bertId, companyId, SHADOW_KEYING);
    const afterBertCombat = runCreatureCombat(afterBert, ARAGORN, 12, null);

    const afterWilliam = playCreatureHazardAndResolve(afterBertCombat, PLAYER_2, williamId, companyId, WILDERNESS_KEYING);
    const afterStrike = runCreatureCombat(afterWilliam, ARAGORN, 12, null);

    expectCharItemCount(afterStrike, RESOURCE_PLAYER, ARAGORN, 1);
  });

  test('hazardsEncountered tracks William after combat', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILLIAM_WULUAG], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const williamId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, williamId, companyId, WILDERNESS_KEYING);
    const afterCombat = runCreatureCombat(afterChain, ARAGORN, 12, null);

    const mhAfter = afterCombat.phaseState as MovementHazardPhaseState;
    expect(mhAfter.hazardsEncountered).toContain('William (Wuluag)');
  });

  test('William alone (no other troll faced) — wound does not discard items', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILLIAM_WULUAG], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const williamId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, williamId, companyId, WILDERNESS_KEYING);
    const afterWound = runCreatureCombat(afterChain, ARAGORN, 2, 5);

    expectCharItemCount(afterWound, RESOURCE_PLAYER, ARAGORN, 1);
  });
});
