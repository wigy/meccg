/**
 * @module tw-103.test
 *
 * Card test: Tom (Tuma) (tw-103)
 * Type: hazard-creature
 * Effects: 1 (on-event: character-wounded-by-self → discard non-special items,
 *   conditional on company having faced Bert or William this turn)
 *
 * "Unique. Troll. One strike. If played against a company that faced
 *  'Bert' or 'William' this turn, each character wounded by 'Tom'
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
  pool,
  playCreatureHazardAndResolve, runCreatureCombat,
  companyIdAt, expectCharItemCount,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CreatureCard, MovementHazardPhaseState } from '../../index.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const DOUBLE_WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };
const WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };
const SHADOW_KEYING = { method: 'region-type' as const, value: 'shadow' };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Tom (Tuma) (tw-103)', () => {
  beforeEach(() => resetMint());

  test('card definition has correct stats and on-event effect', () => {
    const def = pool[TOM_TUMA as string] as CreatureCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-creature');
    expect(def.name).toBe('Tom (Tuma)');
    expect(def.race).toBe('troll');
    expect(def.unique).toBe(true);
    expect(def.strikes).toBe(1);
    expect(def.prowess).toBe(13);
    expect(def.body).toBeNull();
    expect(def.killMarshallingPoints).toBe(1);
    expect(def.effects).toBeDefined();
    expect(def.effects).toHaveLength(1);
    expect(def.effects![0]).toMatchObject({
      type: 'on-event',
      event: 'character-wounded-by-self',
      apply: { type: 'discard-non-special-items' },
      target: 'wounded-character',
    });
    expect(def.effects![0].when).toBeDefined();
  });

  test('combat initiates with 1 strike and 13 prowess', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TOM_TUMA], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur', 'Old Forest'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const tomId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, 0);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, tomId, companyId, DOUBLE_WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(13);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  test('wounded character does NOT discard items when company has not faced Bert or William', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TOM_TUMA], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur', 'Old Forest'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const tomId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, 0);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, tomId, companyId, DOUBLE_WILDERNESS_KEYING);

    const afterWound = runCreatureCombat(afterChain, ARAGORN, 2, 5);
    expect(afterWound.combat).toBeNull();

    expectCharItemCount(afterWound, 0, ARAGORN, 2);

    expect(afterWound.pendingResolutions).toHaveLength(0);
  });

  test('wounded character discards non-special items when company already faced Bert', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BERT_BURAT, TOM_TUMA], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhudaur', 'Old Forest', 'Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const bertId = ready.players[1].hand[0].instanceId;
    const tomId = ready.players[1].hand[1].instanceId;
    const companyId = companyIdAt(ready, 0);

    // Play Bert first — Aragorn wins
    const afterBert = playCreatureHazardAndResolve(ready, PLAYER_2, bertId, companyId, SHADOW_KEYING);
    const afterBertCombat = runCreatureCombat(afterBert, ARAGORN, 12, null);
    expect(afterBertCombat.combat).toBeNull();

    const mhAfterBert = afterBertCombat.phaseState as MovementHazardPhaseState;
    expect(mhAfterBert.hazardsEncountered).toContain('Bert (Burat)');

    // Play Tom next — Aragorn is wounded
    const afterTom = playCreatureHazardAndResolve(afterBertCombat, PLAYER_2, tomId, companyId, DOUBLE_WILDERNESS_KEYING);
    const afterWound = runCreatureCombat(afterTom, ARAGORN, 2, 5);
    expect(afterWound.combat).toBeNull();

    expectCharItemCount(afterWound, 0, ARAGORN, 0);

    const discardDefIds = afterWound.players[0].discardPile.map(c => c.definitionId);
    expect(discardDefIds).toContain(GLAMDRING);
    expect(discardDefIds).toContain(DAGGER_OF_WESTERNESSE);
  });

  test('wounded character discards non-special items when company already faced William', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILLIAM_WULUAG, TOM_TUMA], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhudaur', 'Old Forest', 'Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const williamId = ready.players[1].hand[0].instanceId;
    const tomId = ready.players[1].hand[1].instanceId;
    const companyId = companyIdAt(ready, 0);

    // Play William first — Aragorn wins
    const afterWilliam = playCreatureHazardAndResolve(ready, PLAYER_2, williamId, companyId, WILDERNESS_KEYING);
    const afterWilliamCombat = runCreatureCombat(afterWilliam, ARAGORN, 12, null);

    const mhAfterWilliam = afterWilliamCombat.phaseState as MovementHazardPhaseState;
    expect(mhAfterWilliam.hazardsEncountered).toContain('William (Wuluag)');

    // Play Tom next — Aragorn is wounded
    const afterTom = playCreatureHazardAndResolve(afterWilliamCombat, PLAYER_2, tomId, companyId, DOUBLE_WILDERNESS_KEYING);
    const afterWound = runCreatureCombat(afterTom, ARAGORN, 2, 5);

    expectCharItemCount(afterWound, 0, ARAGORN, 0);
  });

  test('character that defeats Tom does not lose items even when Bert was faced', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BERT_BURAT, TOM_TUMA], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhudaur', 'Old Forest', 'Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const bertId = ready.players[1].hand[0].instanceId;
    const tomId = ready.players[1].hand[1].instanceId;
    const companyId = companyIdAt(ready, 0);

    // Play Bert — Aragorn wins
    const afterBert = playCreatureHazardAndResolve(ready, PLAYER_2, bertId, companyId, SHADOW_KEYING);
    const afterBertCombat = runCreatureCombat(afterBert, ARAGORN, 12, null);

    // Play Tom — Aragorn also wins (high roll)
    const afterTom = playCreatureHazardAndResolve(afterBertCombat, PLAYER_2, tomId, companyId, DOUBLE_WILDERNESS_KEYING);
    const afterStrike = runCreatureCombat(afterTom, ARAGORN, 12, null);

    expectCharItemCount(afterStrike, 0, ARAGORN, 1);
  });

  test('hazardsEncountered tracks creature name after combat', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TOM_TUMA], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur', 'Old Forest'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const tomId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, 0);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, tomId, companyId, DOUBLE_WILDERNESS_KEYING);
    const afterCombat = runCreatureCombat(afterChain, ARAGORN, 12, null);

    const mhAfter = afterCombat.phaseState as MovementHazardPhaseState;
    expect(mhAfter.hazardsEncountered).toContain('Tom (Tuma)');
  });

  test('Tom alone (no other troll faced) — wound does not discard items', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TOM_TUMA], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur', 'Old Forest'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const tomId = ready.players[1].hand[0].instanceId;
    const companyId = companyIdAt(ready, 0);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, tomId, companyId, DOUBLE_WILDERNESS_KEYING);
    const afterWound = runCreatureCombat(afterChain, ARAGORN, 2, 5);

    expectCharItemCount(afterWound, 0, ARAGORN, 1);
  });
});
