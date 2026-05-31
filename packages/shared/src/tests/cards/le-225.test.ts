/**
 * @module le-225.test
 *
 * Card test: Ruse (le-225)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 *
 * Text:
 *   "Diplomat only. Scout only. Playable on a untapped diplomat in a covert
 *    company facing an attack. Tap the diplomat. The attack is canceled.
 *    Alternatively, playable on a scout facing an attack. No strikes of the
 *    attack may be assigned to the scout."
 *
 * Modes:
 *   Mode A (Diplomat): tap an untapped diplomat in the defending (covert)
 *     company to cancel the attack outright.
 *   Mode B (Scout): play the event during an attack; no strikes in the attack
 *     may be assigned to the scout.
 *
 * Engine Support:
 * | # | Rule                                                                  | Status          |
 * |---|-----------------------------------------------------------------------|-----------------|
 * | 1 | Mode A: cancel-attack with diplomat tap cost                          | PARTIAL         |
 * | 2 | Mode A: diplomat must be in a COVERT company                          | NOT IMPLEMENTED |
 * | 3 | Mode B: protect-from-assignment offered when scout is in company       | IMPLEMENTED     |
 * | 4 | Mode B: protected scout cannot be assigned any strike                  | IMPLEMENTED     |
 * | 5 | Mode B: other characters may still be assigned strikes                 | IMPLEMENTED     |
 * | 6 | Mode B: card discarded after use                                       | IMPLEMENTED     |
 * | 7 | Mode B: protection expires after combat ends                           | IMPLEMENTED     |
 *
 * NOT CERTIFIED — Mode A requires covert company tracking which is not yet
 * implemented. `Company` has no covert field; `cancelAttackActions` does not
 * expose `company.covert` in its when-context, so the `cancel-attack` effect
 * with `when: { "company.covert": true }` never fires.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ORC_PATROL,
  viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch, expectInDiscardPile,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import { RegionType, SiteType } from '../../index.js';
import type { ProtectFromStrikeAssignmentAction } from '../../index.js';

const RUSE = 'le-225' as CardDefinitionId;

// Minion fixtures (ringwraith alignment)
const LAGDUF = 'le-18' as CardDefinitionId;       // warrior/orc, no scout skill
const OSTISEN = 'le-36' as CardDefinitionId;      // scout/man

const DOL_GULDUR = 'le-367' as CardDefinitionId;  // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold

const MH_PATH = {
  activeCompanyIndex: 0,
  resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
  resolvedSitePathNames: ['Hithaeglir', 'Eryn Vorn'],
  destinationSiteType: SiteType.ShadowHold,
  destinationSiteName: 'Moria',
} as const;

describe('Ruse (le-225) — Mode B: scout protection', () => {
  beforeEach(() => resetMint());

  test('protect-from-assignment offered when defending company has a scout', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [OSTISEN] }], hand: [RUSE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(combatState.combat).toBeDefined();
    expect(combatState.combat!.phase).toBe('assign-strikes');

    const protectActions = viableActions(combatState, PLAYER_1, 'protect-from-assignment');
    expect(protectActions).toHaveLength(1);

    const protectAction = protectActions[0].action as ProtectFromStrikeAssignmentAction;
    expect(protectAction.cardInstanceId).toBe(handCardId(combatState, RESOURCE_PLAYER));
    // targetCharacterId should be the scout (Ostisen)
    const defPlayer = combatState.players[RESOURCE_PLAYER];
    const ostChar = Object.values(defPlayer.characters).find(
      c => c.definitionId === OSTISEN,
    );
    expect(ostChar).toBeDefined();
    expect(protectAction.targetCharacterId).toBe(ostChar!.instanceId ?? Object.keys(defPlayer.characters).find(k => defPlayer.characters[k]?.definitionId === OSTISEN));
  });

  test('protect-from-assignment NOT offered when defending company has no scout', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [RUSE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(viableActions(combatState, PLAYER_1, 'protect-from-assignment')).toHaveLength(0);
  });

  test('protect-from-assignment NOT available to the attacking player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [OSTISEN] }], hand: [RUSE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    expect(viableActions(combatState, PLAYER_2, 'protect-from-assignment')).toHaveLength(0);
  });

  test('playing Ruse (mode B) discards the card and marks the scout as protected', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [OSTISEN] }], hand: [RUSE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const ruseId = handCardId(stateAtMH, RESOURCE_PLAYER);
    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    const protectActions = viableActions(combatState, PLAYER_1, 'protect-from-assignment');
    expect(protectActions).toHaveLength(1);

    const afterRuse = dispatch(combatState, protectActions[0].action);

    // Ruse is discarded from hand
    expect(afterRuse.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(afterRuse, RESOURCE_PLAYER, ruseId);

    // Scout is now in the protected list
    expect(afterRuse.combat).toBeDefined();
    const protectedList = afterRuse.combat!.protectedFromStrikeAssignment ?? [];
    const defPlayer = afterRuse.players[RESOURCE_PLAYER];
    const ostInstanceId = Object.keys(defPlayer.characters).find(
      k => defPlayer.characters[k]?.definitionId === OSTISEN,
    );
    expect(ostInstanceId).toBeDefined();
    expect(protectedList).toContain(ostInstanceId);
  });

  test('after playing Ruse, the scout cannot be assigned any strike', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [OSTISEN] }], hand: [RUSE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    const protectActions = viableActions(combatState, PLAYER_1, 'protect-from-assignment');
    const afterRuse = dispatch(combatState, protectActions[0].action);

    // After protection, the defending player's assign-strike actions must not
    // include the scout as a target.
    const assignActions = viableActions(afterRuse, PLAYER_1, 'assign-strike');
    const defPlayer = afterRuse.players[RESOURCE_PLAYER];
    const ostInstanceId = Object.keys(defPlayer.characters).find(
      k => defPlayer.characters[k]?.definitionId === OSTISEN,
    );
    const strikeTargetIds = assignActions.map(ea => (ea.action as { characterId?: unknown }).characterId);
    expect(strikeTargetIds).not.toContain(ostInstanceId);
  });

  test('with two characters (scout + non-scout), only non-scout can be assigned strikes after Ruse', () => {
    // ORC_PATROL has 3 strikes, company has Ostisen (scout) + Lagduf (warrior).
    // After Ruse protects Ostisen, only Lagduf may receive strikes.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [OSTISEN, LAGDUF] }], hand: [RUSE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [ORC_PATROL], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH = { ...base, phaseState: makeMHState(MH_PATH) };

    const orcPatrolId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, orcPatrolId, targetCompanyId,
      { method: 'region-type', value: 'wilderness' },
    );

    // Before Ruse: both characters are eligible
    const assignBefore = viableActions(combatState, PLAYER_1, 'assign-strike');
    const defPlayer0 = combatState.players[RESOURCE_PLAYER];
    const ostId = Object.keys(defPlayer0.characters).find(
      k => defPlayer0.characters[k]?.definitionId === OSTISEN,
    );
    const lagdufId = Object.keys(defPlayer0.characters).find(
      k => defPlayer0.characters[k]?.definitionId === LAGDUF,
    );
    expect(assignBefore.some(ea => (ea.action as { characterId?: unknown }).characterId === ostId)).toBe(true);
    expect(assignBefore.some(ea => (ea.action as { characterId?: unknown }).characterId === lagdufId)).toBe(true);

    // Play Ruse targeting Ostisen
    const protectActions = viableActions(combatState, PLAYER_1, 'protect-from-assignment');
    expect(protectActions).toHaveLength(1);
    const afterRuse = dispatch(combatState, protectActions[0].action);

    // After Ruse: only Lagduf is a valid assignment target
    const assignAfter = viableActions(afterRuse, PLAYER_1, 'assign-strike');
    const strikeTargetIds = assignAfter.map(ea => (ea.action as { characterId?: unknown }).characterId);
    expect(strikeTargetIds).not.toContain(ostId);
    expect(strikeTargetIds).toContain(lagdufId);
  });
});

describe('Ruse (le-225) — Mode A: diplomat cancel-attack (NOT IMPLEMENTED)', () => {
  beforeEach(() => resetMint());

  test.todo('Mode A: playable when defending company has an untapped diplomat AND is covert (covert tracking not yet implemented)');
  test.todo('Mode A: NOT playable when the defending company is not covert');
  test.todo('Mode A: NOT playable when the only diplomat is tapped');
  test.todo('Mode A: taps the chosen diplomat and cancels the attack');
});
