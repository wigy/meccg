/**
 * @module tw-207.test
 *
 * Card test: Dark Quarrels (tw-207)
 * Type: hero-resource-event (short)
 * Effects:
 *   1. cancel-attack — cancel one attack by Orcs, Trolls, or Men (no tap cost)
 *   2. halve-strikes — if Gates of Morning is in play, halve strikes of any attack (rounded up)
 *
 * "Cancel one attack by Orcs, Trolls, or Men. Alternatively, if Gates of
 * Morning is in play, the number of strikes from any attack is reduced to
 * half of its original number, rounded up."
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                               |
 * |---|------------------------------------------------|-------------|-------------------------------------|
 * | 1 | cancel-attack with when condition (race filter) | IMPLEMENTED | combat legal actions + reducer       |
 * | 2 | Costless cancel-attack (no tap required)        | IMPLEMENTED | scoutInstanceId optional             |
 * | 3 | halve-strikes during assign-strikes             | IMPLEMENTED | combat legal actions + reducer       |
 * | 4 | halve-strikes gated by inPlay condition         | IMPLEMENTED | condition-matcher checks inPlay      |
 * | 5 | Card discarded after use                        | IMPLEMENTED | reducer moves card to discard        |
 * | 6 | Combat canceled (cancel-attack)                 | IMPLEMENTED | reducer sets combat to null          |
 * | 7 | Strikes halved rounded up                       | IMPLEMENTED | Math.ceil in reducer                 |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  ORC_PATROL, CAVE_DRAKE, DARK_QUARRELS, GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  pool, viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  CardStatus,
  handCardId, companyIdAt, dispatch, expectCharStatus, expectInDiscardPile,
} from '../test-helpers.js';
import type { CancelAttackAction } from '../../index.js';
import type { HeroResourceEventCard } from '../../index.js';
import { RegionType, SiteType, computeLegalActions } from '../../index.js';
import type { CancelAttackEffect, HalveStrikesEffect } from '../../types/effects.js';
import type { CardInPlay, CardInstanceId } from '../../index.js';

describe('Dark Quarrels (tw-207)', () => {
  beforeEach(() => resetMint());

  test('card definition has cancel-attack and halve-strikes effects', () => {
    const def = pool[DARK_QUARRELS as string] as HeroResourceEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-resource-event');
    expect(def.eventType).toBe('short');

    const cancelAttack = def.effects?.find(
      (e): e is CancelAttackEffect => e.type === 'cancel-attack',
    );
    expect(cancelAttack).toBeDefined();
    expect(cancelAttack!.cost).toBeUndefined();
    expect(cancelAttack!.requiredSkill).toBeUndefined();
    expect(cancelAttack!.when).toBeDefined();

    const halveStrikes = def.effects?.find(
      (e): e is HalveStrikesEffect => e.type === 'halve-strikes',
    );
    expect(halveStrikes).toBeDefined();
    expect(halveStrikes!.when).toBeDefined();
  });

  test('cancel-attack available against Orc attack (no tap cost)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [DARK_QUARRELS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();
    expect(combatState.combat!.phase).toBe('assign-strikes');

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
    const cancelAction = cancelActions[0].action as CancelAttackAction;
    expect(cancelAction.scoutInstanceId).toBeUndefined();
    expect(cancelAction.cardInstanceId).toBe(handCardId(combatState, 0));
  });

  test('executing cancel-attack discards card and cancels combat (no tap)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [DARK_QUARRELS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    const after = dispatch(combatState, cancelActions[0].action);

    // Combat canceled
    expect(after.combat).toBeNull();

    // Dark Quarrels in discard, hand empty
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, 0, DARK_QUARRELS);

    // Aragorn remains untapped (no tap cost)
    expectCharStatus(after, 0, ARAGORN, CardStatus.Untapped);

    // Creature in attacker's discard
    expectInDiscardPile(after, 1, ORC_PATROL);
  });

  test('cancel-attack NOT available against non-Orc/Troll/Men attack (e.g. dragon)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [DARK_QUARRELS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const caveDrakeId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, caveDrakeId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('halve-strikes available when Gates of Morning is in play', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [DARK_QUARRELS], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const caveDrakeId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, caveDrakeId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();

    // cancel-attack should NOT be available (dragon, not orc/troll/men)
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);

    // halve-strikes SHOULD be available (Gates of Morning in play)
    const halveActions = viableActions(combatState, PLAYER_1, 'halve-strikes');
    expect(halveActions.length).toBe(1);
  });

  test('executing halve-strikes halves the strike count (rounded up)', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [DARK_QUARRELS], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    // Orc-patrol has 3 strikes
    const orcPatrolId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat!.strikesTotal).toBe(3);

    // Both cancel-attack AND halve-strikes should be available (orc + GoM in play)
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);

    const halveActions = viableActions(combatState, PLAYER_1, 'halve-strikes');
    expect(halveActions.length).toBe(1);

    // Execute halve-strikes
    const after = dispatch(combatState, halveActions[0].action);

    // Strikes halved: 3 → 2 (ceil(3/2) = 2)
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(2);

    // Dark Quarrels in discard
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, 0, DARK_QUARRELS);

    // Combat still active (not canceled, just modified)
    expect(after.combat!.phase).toBe('assign-strikes');
  });

  test('halve-strikes NOT available when Gates of Morning is NOT in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [DARK_QUARRELS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // cancel-attack available (orc), but halve-strikes NOT available (no GoM)
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);

    const halveActions = viableActions(combatState, PLAYER_1, 'halve-strikes');
    expect(halveActions).toHaveLength(0);
  });

  test('Dark Quarrels is NOT playable during long-event phase (combat-only)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [DARK_QUARRELS], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const shortEventActions = actions.filter(a => a.action.type === 'play-short-event');
    expect(shortEventActions).toHaveLength(0);

    const notPlayable = actions.filter(a => a.action.type === 'not-playable');
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('halve-strikes with even number of strikes halves exactly', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }], hand: [DARK_QUARRELS], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    // Cave-drake has 2 strikes (even number)
    const caveDrakeId = handCardId(stateAtMH, 1);
    const targetCompanyId = companyIdAt(stateAtMH, 0);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, caveDrakeId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat!.strikesTotal).toBe(2);

    const halveActions = viableActions(combatState, PLAYER_1, 'halve-strikes');
    expect(halveActions.length).toBe(1);

    const afterHalve = dispatch(combatState, halveActions[0].action);

    // Strikes halved: 2 → 1 (ceil(2/2) = 1)
    expect(afterHalve.combat!.strikesTotal).toBe(1);
  });
});
