/**
 * @module cancel-attack-targets.test
 *
 * Regression test for bug report b48ec7c065b23329 (game ms6gbt8d-5na91m, seq
 * 231): "Did not have a chance to select cancel option." The engine legally
 * offered two `cancel-attack` actions for the same scout (Corsair Corax
 * Ravenkin, p1-98) when playing The Tormented Earth (as-102) — one to cancel
 * the attack outright, one to reduce prowess by 3 ("your choice") — but the
 * combat view's `cancelAttackScoutMap` was keyed only by scout instance ID,
 * so the second action processed silently overwrote the first and the player
 * never saw a choice.
 *
 * `groupCancelAttackActionsByScout` now collects every action for a scout
 * into a list instead of collapsing to one, so the combat view can offer all
 * of them.
 */

import { describe, test, expect } from 'vitest';
import type { CardInstanceId } from '@meccg/shared';
import { groupCancelAttackActionsByScout } from './cancel-attack-targets.js';

const TORMENTED_EARTH = 'p1-31' as CardInstanceId;
const OTHER_CARD = 'p1-32' as CardInstanceId;
const SCOUT = 'p1-98' as CardInstanceId;
const OTHER_SCOUT = 'p1-99' as CardInstanceId;

interface FakeCancelAttackAction {
  readonly cardInstanceId: CardInstanceId;
  readonly scoutInstanceId?: CardInstanceId;
  readonly mode?: 'reduce-prowess';
}

describe('groupCancelAttackActionsByScout', () => {
  test('keeps both modes of a dual-mode cancel-attack card for the same scout', () => {
    const cancelAction: FakeCancelAttackAction = { cardInstanceId: TORMENTED_EARTH, scoutInstanceId: SCOUT };
    const reduceProwessAction: FakeCancelAttackAction = {
      cardInstanceId: TORMENTED_EARTH,
      scoutInstanceId: SCOUT,
      mode: 'reduce-prowess',
    };

    const map = groupCancelAttackActionsByScout([cancelAction, reduceProwessAction], TORMENTED_EARTH);

    expect(map.get(SCOUT as string)).toEqual([cancelAction, reduceProwessAction]);
  });

  test('ignores actions for cards other than the selected one', () => {
    const selected: FakeCancelAttackAction = { cardInstanceId: TORMENTED_EARTH, scoutInstanceId: SCOUT };
    const other: FakeCancelAttackAction = { cardInstanceId: OTHER_CARD, scoutInstanceId: SCOUT };

    const map = groupCancelAttackActionsByScout([selected, other], TORMENTED_EARTH);

    expect(map.get(SCOUT as string)).toEqual([selected]);
  });

  test('ignores costless cancel-attack actions with no scout', () => {
    const costless: FakeCancelAttackAction = { cardInstanceId: TORMENTED_EARTH };

    const map = groupCancelAttackActionsByScout([costless], TORMENTED_EARTH);

    expect(map.size).toBe(0);
  });

  test('keeps separate scouts in separate groups', () => {
    const forScout: FakeCancelAttackAction = { cardInstanceId: TORMENTED_EARTH, scoutInstanceId: SCOUT };
    const forOtherScout: FakeCancelAttackAction = { cardInstanceId: TORMENTED_EARTH, scoutInstanceId: OTHER_SCOUT };

    const map = groupCancelAttackActionsByScout([forScout, forOtherScout], TORMENTED_EARTH);

    expect(map.get(SCOUT as string)).toEqual([forScout]);
    expect(map.get(OTHER_SCOUT as string)).toEqual([forOtherScout]);
  });
});
