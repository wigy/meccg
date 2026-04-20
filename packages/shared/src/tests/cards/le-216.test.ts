/**
 * @module le-216.test
 *
 * Card test: Orc Quarrels (le-216)
 * Type: minion-resource-event (short)
 * Effects:
 *   1. cancel-attack — cancel one attack by Orcs, Trolls, or Men (no tap cost)
 *   2. halve-strikes — if Skies of Fire is in play, halve strikes of any
 *      attack (rounded up)
 *
 * "Playable on an Orc, Troll, or Man attack. The attack is canceled.
 * Alternatively, playable on any attack if Skies of Fire is in play. The
 * number of strikes from the attack is reduced to half of its original
 * number (rounded up)."
 *
 * This is the minion-side counterpart to Dark Quarrels (tw-207): identical
 * mechanics except the environmental trigger is Skies of Fire (le-228) in
 * place of Gates of Morning. Both cancel-attack and halve-strikes are
 * alignment-agnostic in the engine, so this card certifies the minion
 * flow against minion fixtures.
 *
 * Engine Support:
 * | # | Feature                                       | Status      | Notes                                |
 * |---|-----------------------------------------------|-------------|--------------------------------------|
 * | 1 | cancel-attack with `enemy.race` $in filter    | IMPLEMENTED | combat legal actions + reducer       |
 * | 2 | Costless cancel-attack (no character tap)     | IMPLEMENTED | scoutInstanceId optional             |
 * | 3 | halve-strikes during assign-strikes           | IMPLEMENTED | combat legal actions + reducer       |
 * | 4 | halve-strikes gated by `inPlay: Skies of Fire`| IMPLEMENTED | name-in-play check via condition-matcher |
 * | 5 | Card discarded after use                      | IMPLEMENTED | reducer moves card to discard        |
 * | 6 | Combat canceled via chain                     | IMPLEMENTED | reducer sets combat to null          |
 * | 7 | Strikes halved rounded up                     | IMPLEMENTED | Math.ceil in reducer                 |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ORC_PATROL, CAVE_DRAKE, BERT_BURAT,
  viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  CardStatus,
  handCardId, companyIdAt, dispatch, expectCharStatus, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CancelAttackAction } from '../../index.js';
import { RegionType, SiteType, computeLegalActions } from '../../index.js';
import type { CardInPlay, CardDefinitionId, CardInstanceId } from '../../index.js';

const ORC_QUARRELS = 'le-216' as CardDefinitionId;
const SKIES_OF_FIRE = 'le-228' as CardDefinitionId;
const AMBUSHER = 'le-59' as CardDefinitionId; // men-race creature, keyed to border/free regions

// Minion fixtures — referenced only in this test file.
const LAGDUF = 'le-18' as CardDefinitionId;       // warrior, orc, prow 5
const OSTISEN = 'le-36' as CardDefinitionId;      // scout, man, prow 3

const DOL_GULDUR = 'le-367' as CardDefinitionId;  // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold

describe('Orc Quarrels (le-216)', () => {
  beforeEach(() => resetMint());

  test('cancel-attack is available against an Orc attack (no tap cost)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
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
    expect(cancelAction.cardInstanceId).toBe(handCardId(combatState, RESOURCE_PLAYER));
  });

  test('cancel-attack is available against a Troll attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [BERT_BURAT], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const trollId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, trollId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
  });

  test('cancel-attack is available against a Men attack', () => {
    // Ambusher (le-59) is men-race, keyed to border/free regions.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [AMBUSHER], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Eriador'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Bag End',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const ambusherId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, ambusherId, targetCompanyId,
      { method: 'region-type', value: 'border' },
    );

    expect(combatState.combat).toBeDefined();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
  });

  test('cancel-attack is NOT available against a non-Orc/Troll/Men attack (dragon)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [CAVE_DRAKE], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const caveDrakeId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, caveDrakeId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('executing cancel-attack discards card and cancels combat (no tap)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    const declared = dispatch(combatState, cancelActions[0].action);

    // Declaration initiates a chain — combat still live until chain resolves.
    expect(declared.chain).not.toBeNull();
    expect(declared.combat).not.toBeNull();

    // Orc Quarrels in discard; hand empty.
    expect(declared.players[0].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, ORC_QUARRELS);

    // Lagduf stays untapped — Orc Quarrels has no character-tap cost.
    expectCharStatus(declared, RESOURCE_PLAYER, LAGDUF, CardStatus.Untapped);

    const after = resolveChain(declared);
    expect(after.combat).toBeNull();

    // Creature in attacker's discard.
    expectInDiscardPile(after, HAZARD_PLAYER, ORC_PATROL);
  });

  test('halve-strikes is available when Skies of Fire is in play (dragon attack)', () => {
    const sofInPlay: CardInPlay = {
      instanceId: 'sof-1' as CardInstanceId,
      definitionId: SKIES_OF_FIRE,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR], cardsInPlay: [sofInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [CAVE_DRAKE], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const caveDrakeId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, caveDrakeId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();

    // cancel-attack must NOT be available — dragon is not orc/troll/men.
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);

    // halve-strikes IS available because Skies of Fire is in play.
    const halveActions = viableActions(combatState, PLAYER_1, 'halve-strikes');
    expect(halveActions.length).toBe(1);
  });

  test('executing halve-strikes halves the strike count (rounded up)', () => {
    const sofInPlay: CardInPlay = {
      instanceId: 'sof-1' as CardInstanceId,
      definitionId: SKIES_OF_FIRE,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR], cardsInPlay: [sofInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    // Orc-patrol has 3 strikes.
    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat!.strikesTotal).toBe(3);

    // Both cancel-attack (orc) and halve-strikes (SoF) are available.
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack').length).toBe(1);

    const halveActions = viableActions(combatState, PLAYER_1, 'halve-strikes');
    expect(halveActions.length).toBe(1);

    const after = dispatch(combatState, halveActions[0].action);

    // Strikes halved: 3 → 2 (ceil(3/2)).
    expect(after.combat).toBeDefined();
    expect(after.combat!.strikesTotal).toBe(2);

    // Card discarded, hand empty.
    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, ORC_QUARRELS);

    // Combat still active (modified, not canceled).
    expect(after.combat!.phase).toBe('assign-strikes');
  });

  test('halve-strikes with even number of strikes halves exactly', () => {
    const sofInPlay: CardInPlay = {
      instanceId: 'sof-1' as CardInstanceId,
      definitionId: SKIES_OF_FIRE,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF, OSTISEN] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR], cardsInPlay: [sofInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [CAVE_DRAKE], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    // Cave-drake has 2 strikes (even).
    const caveDrakeId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, caveDrakeId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat!.strikesTotal).toBe(2);

    const halveActions = viableActions(combatState, PLAYER_1, 'halve-strikes');
    expect(halveActions.length).toBe(1);

    const afterHalve = dispatch(combatState, halveActions[0].action);

    // 2 → 1 (ceil(2/2)).
    expect(afterHalve.combat!.strikesTotal).toBe(1);
  });

  test('halve-strikes is NOT available when Skies of Fire is NOT in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // cancel-attack still available (orc), halve-strikes is not (no Skies of Fire).
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack').length).toBe(1);
    expect(viableActions(combatState, PLAYER_1, 'halve-strikes')).toHaveLength(0);
  });

  test('Orc Quarrels is NOT playable outside combat (long-event phase)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const shortEventActions = actions.filter(a => a.action.type === 'play-short-event');
    expect(shortEventActions).toHaveLength(0);

    const notPlayable = actions.filter(a => a.action.type === 'not-playable');
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('cancel-attack is NOT available to the attacking player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [ORC_QUARRELS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });

    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const stateAtMH = { ...base, phaseState: mhState };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // P2 is the attacker.
    expect(viableActions(combatState, PLAYER_2, 'cancel-attack')).toHaveLength(0);
    expect(viableActions(combatState, PLAYER_2, 'halve-strikes')).toHaveLength(0);
  });
});
