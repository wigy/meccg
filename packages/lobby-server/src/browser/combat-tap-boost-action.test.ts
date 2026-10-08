/**
 * @module combat-tap-boost-action.test
 *
 * Regression test for bug report "Lore of Ages" (game muz5vlfa-7ohebq,
 * seq 1508): while the bearer's company was facing an attack, the engine
 * offered `tap-ally-combat-boost` for Lore of the Ages (td-129) in the
 * assign-strikes and resolve-strike windows, but the combat view had no
 * click target for it — the player never saw a way to use the ability.
 *
 * combat-view.ts now resolves the action against each attachment under a
 * character via `resolveTapCombatBoostAction`; this asserts the lookup hits
 * the Lore of the Ages card itself and not its bearer or other items.
 */

import { describe, test, expect } from 'vitest';
import type { CardInstanceId, PlayerId, SupportStrikeAction, TapAllyCombatBoostAction } from '@meccg/shared';
import { resolveTapCombatBoostAction, tapCombatBoostChoices } from './combat-tap-boost-action.js';

const LORE_INSTANCE_ID = 'p1-56' as CardInstanceId;
const BEARER_INSTANCE_ID = 'p1-4' as CardInstanceId;
const OTHER_ITEM_INSTANCE_ID = 'p1-238' as CardInstanceId;

const LORE_ACTION: TapAllyCombatBoostAction = {
  type: 'tap-ally-combat-boost',
  player: 'p1' as PlayerId,
  cardInstanceId: LORE_INSTANCE_ID,
  characterInstanceId: BEARER_INSTANCE_ID,
};

describe('resolveTapCombatBoostAction', () => {
  test('resolves the boost for the Lore of the Ages card under its bearer', () => {
    expect(resolveTapCombatBoostAction([LORE_ACTION], LORE_INSTANCE_ID as string)).toBe(LORE_ACTION);
  });

  test('does not resolve for the bearer or another item', () => {
    expect(resolveTapCombatBoostAction([LORE_ACTION], BEARER_INSTANCE_ID as string)).toBeUndefined();
    expect(resolveTapCombatBoostAction([LORE_ACTION], OTHER_ITEM_INSTANCE_ID as string)).toBeUndefined();
  });

  test('returns undefined when no boost is legal', () => {
    expect(resolveTapCombatBoostAction([], LORE_INSTANCE_ID as string)).toBeUndefined();
  });
});

describe('tapCombatBoostChoices', () => {
  test('an item source offers just the boost', () => {
    const choices = tapCombatBoostChoices(LORE_ACTION);
    expect(choices.map(c => c.action)).toEqual([LORE_ACTION]);
  });

  test('an ally source that can also support keeps both choices', () => {
    const support: SupportStrikeAction = {
      type: 'support-strike',
      player: 'p1' as PlayerId,
      supportingCharacterId: LORE_INSTANCE_ID,
      targetCharacterId: BEARER_INSTANCE_ID,
    };
    const choices = tapCombatBoostChoices(LORE_ACTION, undefined, support);
    expect(choices.map(c => c.action)).toEqual([LORE_ACTION, support]);
  });
});
