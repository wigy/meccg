/**
 * @module tw-016.test
 *
 * Card test: Bert (Burat) (tw-016)
 * Type: hazard-creature
 * Effects: 1 (on-event: character-wounded-by-self → discard non-special items,
 *   conditional on company having faced William or Tom this turn)
 *
 * "Unique. Troll. One strike. If played against a company that faced
 *  'William' or 'Tom' this turn, each character wounded by 'Bert'
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
  handCardId, companyIdAt, expectCharItemCount,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CreatureCard, MovementHazardPhaseState } from '../../index.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };
const SHADOW_KEYING = { method: 'region-type' as const, value: 'shadow' };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Bert (Burat) (tw-016)', () => {
  beforeEach(() => resetMint());

  test('card definition has correct stats and on-event effect', () => {
    const def = pool[BERT_BURAT as string] as CreatureCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-creature');
    expect(def.name).toBe('Bert (Burat)');
    expect(def.race).toBe('troll');
    expect(def.unique).toBe(true);
    expect(def.strikes).toBe(1);
    expect(def.prowess).toBe(12);
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

  test('combat initiates with 1 strike and 12 prowess', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BERT_BURAT], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const bertId = handCardId(ready, 1);
    const companyId = companyIdAt(ready, 0);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, bertId, companyId, SHADOW_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(12);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  test('wounded character does NOT discard items when company has not faced William or Tom', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BERT_BURAT], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const bertId = handCardId(ready, 1);
    const companyId = companyIdAt(ready, 0);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, bertId, companyId, SHADOW_KEYING);

    // Strike roll 2: low → wounded. Body check 5 → survives.
    const afterWound = runCreatureCombat(afterChain, ARAGORN, 2, 5);
    expect(afterWound.combat).toBeNull();

    // Items should still be on Aragorn since no prior troll was faced
    expectCharItemCount(afterWound, 0, ARAGORN, 2);

    // No pending resolutions — effect did not trigger
    expect(afterWound.pendingResolutions).toHaveLength(0);
  });

  test('wounded character discards non-special items when company already faced William', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILLIAM_WULUAG, BERT_BURAT], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhudaur', 'Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const williamId = handCardId(ready, 1, 0);
    const bertId = handCardId(ready, 1, 1);
    const companyId = companyIdAt(ready, 0);

    // Play William first — high roll so Aragorn wins
    const afterWilliam = playCreatureHazardAndResolve(ready, PLAYER_2, williamId, companyId, WILDERNESS_KEYING);
    const afterWilliamCombat = runCreatureCombat(afterWilliam, ARAGORN, 12, null);
    expect(afterWilliamCombat.combat).toBeNull();

    // Verify William is recorded in hazardsEncountered
    const mhAfterWilliam = afterWilliamCombat.phaseState as MovementHazardPhaseState;
    expect(mhAfterWilliam.hazardsEncountered).toContain('William (Wuluag)');

    // Play Bert next
    const afterBert = playCreatureHazardAndResolve(afterWilliamCombat, PLAYER_2, bertId, companyId, SHADOW_KEYING);

    // Strike roll 2: low → wounded. Body check 5 → survives.
    const afterWound = runCreatureCombat(afterBert, ARAGORN, 2, 5);
    expect(afterWound.combat).toBeNull();

    // Aragorn's non-special items should be discarded
    expectCharItemCount(afterWound, 0, ARAGORN, 0);

    // Items should be in the discard pile
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
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TOM_TUMA, BERT_BURAT], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhudaur', 'Old Forest', 'Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const tomId = handCardId(ready, 1, 0);
    const bertId = handCardId(ready, 1, 1);
    const companyId = companyIdAt(ready, 0);

    // Play Tom first — Aragorn wins the strike
    const afterTom = playCreatureHazardAndResolve(ready, PLAYER_2, tomId, companyId, WILDERNESS_KEYING);
    const afterTomCombat = runCreatureCombat(afterTom, ARAGORN, 12, null);

    const mhAfterTom = afterTomCombat.phaseState as MovementHazardPhaseState;
    expect(mhAfterTom.hazardsEncountered).toContain('Tom (Tuma)');

    // Play Bert next — Aragorn is wounded
    const afterBert = playCreatureHazardAndResolve(afterTomCombat, PLAYER_2, bertId, companyId, SHADOW_KEYING);
    const afterWound = runCreatureCombat(afterBert, ARAGORN, 2, 5);

    // Glamdring should be discarded
    expectCharItemCount(afterWound, 0, ARAGORN, 0);
  });

  test('character that defeats Bert does not lose items even when William was faced', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILLIAM_WULUAG, BERT_BURAT], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness, RegionType.Shadow],
      resolvedSitePathNames: ['Rhudaur', 'Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const williamId = handCardId(ready, 1, 0);
    const bertId = handCardId(ready, 1, 1);
    const companyId = companyIdAt(ready, 0);

    // Play William — Aragorn wins
    const afterWilliam = playCreatureHazardAndResolve(ready, PLAYER_2, williamId, companyId, WILDERNESS_KEYING);
    const afterWilliamCombat = runCreatureCombat(afterWilliam, ARAGORN, 12, null);

    // Play Bert — Aragorn also wins (high roll)
    const afterBert = playCreatureHazardAndResolve(afterWilliamCombat, PLAYER_2, bertId, companyId, SHADOW_KEYING);
    const afterStrike = runCreatureCombat(afterBert, ARAGORN, 12, null);

    // Aragorn wins → no item discard
    expectCharItemCount(afterStrike, 0, ARAGORN, 1);
  });

  test('hazardsEncountered tracks creature name after combat', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BERT_BURAT], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const bertId = handCardId(ready, 1);
    const companyId = companyIdAt(ready, 0);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, bertId, companyId, SHADOW_KEYING);
    const afterCombat = runCreatureCombat(afterChain, ARAGORN, 12, null);

    const mhAfter = afterCombat.phaseState as MovementHazardPhaseState;
    expect(mhAfter.hazardsEncountered).toContain('Bert (Burat)');
  });

  test('Bert alone (no other troll faced) — wound does not discard items', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BERT_BURAT], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };

    const bertId = handCardId(ready, 1);
    const companyId = companyIdAt(ready, 0);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, bertId, companyId, SHADOW_KEYING);
    const afterWound = runCreatureCombat(afterChain, ARAGORN, 2, 5);

    expectCharItemCount(afterWound, 0, ARAGORN, 1);
  });
});
