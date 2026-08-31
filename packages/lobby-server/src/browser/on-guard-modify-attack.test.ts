/**
 * @module on-guard-modify-attack-panel.test
 *
 * Regression test for bug report 6468ea4963b2fff9 (game mthd1qtm-uee04u, seq
 * 389): the hazard player placed Unabated in Malice (ba-26) on-guard during
 * M/H (movement-hazard.ts deliberately routes its from-hand `modify-attack`
 * mode through on-guard placement rather than an open M/H play — it has no
 * effect until an automatic-attack exists to modify). When the company later
 * faced the site's automatic-attack, the engine correctly offered a
 * `modify-attack` action for the on-guard card during the pre-assignment
 * window (CoE rule 2.V.i) — verified by replaying the log through
 * `computeLegalActions` — but nothing in the browser client could dispatch
 * it: `modifyAttackMap` in combat-view.ts only wires clicks for in-play
 * items/allies attached to a character, and on-guard cards have no character
 * to click on.
 *
 * `onGuardModifyAttackActions` now identifies exactly those `modify-attack`
 * actions sourced from an unrevealed on-guard card (as opposed to an
 * in-play item/ally, which already has its own click target), so
 * `renderCombatView` can surface them in a dedicated clickable panel.
 */

import { describe, test, expect } from 'vitest';
import type { CardInstanceId, Company, ModifyAttackAction } from '@meccg/shared';
import { onGuardModifyAttackActions } from './on-guard-modify-attack.js';

const UNABATED = 'p1-34' as CardInstanceId;
const REVEALED_EVENT = 'p1-33' as CardInstanceId;
const TORQUE_ITEM = 'p1-30' as CardInstanceId;

function companyWithOnGuardCards(): Company {
  return {
    id: 'company-p2-0',
    characters: [],
    currentSite: null,
    siteCardOwned: true,
    destinationSite: null,
    movementPath: [],
    moved: false,
    siteOfOrigin: null,
    onGuardCards: [
      { instanceId: UNABATED, definitionId: 'ba-26', revealed: false },
      { instanceId: REVEALED_EVENT, definitionId: 'ba-26', revealed: true },
    ],
    hazards: [],
  } as unknown as Company;
}

function modifyAttack(cardInstanceId: CardInstanceId): ModifyAttackAction {
  return { type: 'modify-attack', player: 'p1', cardInstanceId } as ModifyAttackAction;
}

describe('onGuardModifyAttackActions (Unabated in Malice revealed onto an automatic-attack)', () => {
  test('includes the unrevealed on-guard card modify-attack action', () => {
    const actions = [modifyAttack(UNABATED)];
    const result = onGuardModifyAttackActions(companyWithOnGuardCards(), actions);
    expect(result).toEqual([modifyAttack(UNABATED)]);
  });

  test('excludes an already-revealed on-guard card', () => {
    const actions = [modifyAttack(REVEALED_EVENT)];
    const result = onGuardModifyAttackActions(companyWithOnGuardCards(), actions);
    expect(result).toEqual([]);
  });

  test('excludes an in-play item/ally modify-attack action (already has its own click target)', () => {
    const actions = [modifyAttack(TORQUE_ITEM)];
    const result = onGuardModifyAttackActions(companyWithOnGuardCards(), actions);
    expect(result).toEqual([]);
  });

  test('returns nothing when the company is not found', () => {
    const result = onGuardModifyAttackActions(undefined, [modifyAttack(UNABATED)]);
    expect(result).toEqual([]);
  });
});
