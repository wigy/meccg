/**
 * @module wh-43.test
 *
 * Card test: Crept Along Cleverly (wh-43)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 *
 * Text:
 *   "Ranger only. Cancels a Wolf, Animal, Spider, Dragon, Drake, or Undead
 *    attack against a ranger's company."
 *
 * Effects:
 *   1. cancel-attack — requires a ranger in the defending company; cancels one
 *      attack whose race is wolf, animal, spider, dragon, drake, or undead.
 *      No tap cost.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ORC_PATROL, BARROW_WIGHT,
  viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId, findHandCardId, companyIdAt, dispatch, expectInDiscardPile, resolveChain,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  expectCharStatus, CardStatus,
} from '../test-helpers.js';
import type { CancelAttackAction } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import { RegionType, SiteType, computeLegalActions } from '../../index.js';

const CREPT_ALONG_CLEVERLY = 'wh-43' as CardDefinitionId;

// Minion fixtures (ringwraith alignment)
const ERADAN = 'le-10' as CardDefinitionId;       // scout/ranger
const LAGDUF = 'le-18' as CardDefinitionId;       // warrior — no ranger skill
const WARGS = 'tw-109' as CardDefinitionId;        // wolves race (normalizes to "wolf")

const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion darkhaven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold

const MH_PATH = {
  activeCompanyIndex: 0,
  resolvedSitePath: [RegionType.Shadow],
  resolvedSitePathNames: ['Gorgoroth'],
  destinationSiteType: SiteType.ShadowHold,
  destinationSiteName: 'Moria',
} as const;

describe('Crept Along Cleverly (wh-43)', () => {
  beforeEach(() => resetMint());

  test('cancel-attack available against qualifying race (wolves) when ranger is in company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [ERADAN] }], hand: [CREPT_ALONG_CLEVERLY], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [WARGS], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const wargsId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, wargsId, targetCompanyId,
      { method: 'region-type', value: 'shadow' },
    );

    expect(combatState.combat).toBeDefined();
    expect(combatState.combat!.phase).toBe('assign-strikes');

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
    const cancelAction = cancelActions[0].action as CancelAttackAction;
    // No tap cost — scoutInstanceId is undefined
    expect(cancelAction.scoutInstanceId).toBeUndefined();
  });

  test('cancel-attack available against undead (Barrow-wight) when ranger is in company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [ERADAN] }], hand: [CREPT_ALONG_CLEVERLY], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [BARROW_WIGHT], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const barrowWightId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, barrowWightId, targetCompanyId,
      { method: 'region-type', value: 'shadow' },
    );

    expect(combatState.combat).toBeDefined();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
  });

  test('executing cancel-attack discards card, cancels combat, does NOT tap ranger', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [ERADAN] }], hand: [CREPT_ALONG_CLEVERLY], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [BARROW_WIGHT], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const barrowWightId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, barrowWightId, targetCompanyId,
      { method: 'region-type', value: 'shadow' },
    );

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    const declared = dispatch(combatState, cancelActions[0].action);

    // Card discarded from hand
    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, CREPT_ALONG_CLEVERLY);

    // Ranger is NOT tapped (no tap cost)
    expectCharStatus(declared, RESOURCE_PLAYER, ERADAN, CardStatus.Untapped);

    // Resolve chain → combat cleared
    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
    expectInDiscardPile(after, HAZARD_PLAYER, BARROW_WIGHT);
  });

  test('cancel-attack NOT available against non-qualifying race (orc)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [ERADAN] }], hand: [CREPT_ALONG_CLEVERLY], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'shadow' },
    );

    expect(combatState.combat).toBeDefined();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-attack NOT available when no ranger in company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [CREPT_ALONG_CLEVERLY], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ERADAN] }], hand: [BARROW_WIGHT], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const barrowWightId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, barrowWightId, targetCompanyId,
      { method: 'region-type', value: 'shadow' },
    );

    expect(combatState.combat).toBeDefined();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('not-playable reason does not claim "outside combat" while an attack is active', () => {
    // Regression: during the live combat cancel-window, the generic
    // resource-short-event path used to still tag the card
    // "can only be played during combat" even though combat was already
    // under way — the actual reason it can't be played is the missing
    // Ranger in the defending company. The card should either be silently
    // omitted from `not-playable`, or given an accurate reason — never the
    // combat-window message while already in combat.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [CREPT_ALONG_CLEVERLY], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ERADAN] }], hand: [BARROW_WIGHT], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const barrowWightId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, barrowWightId, targetCompanyId,
      { method: 'region-type', value: 'shadow' },
    );

    expect(combatState.combat).toBeDefined();
    const creptAlongCleverlyId = findHandCardId(combatState, RESOURCE_PLAYER, CREPT_ALONG_CLEVERLY);
    const notPlayable = computeLegalActions(combatState, PLAYER_1).find(
      ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: unknown }).cardInstanceId === creptAlongCleverlyId,
    );
    if (notPlayable) {
      expect(notPlayable.reason).not.toMatch(/can only be played during combat/i);
    }
  });
});
