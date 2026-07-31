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
 *
 * Also covers bug report 5e858fb065b0c227 (game ms8y3wig-1bg5qc, seq 140):
 * "Ne demande pas sur quel personnage il doit être joué" — Flatter a Foe
 * (td-116) emits one `cancel-attack` action per company character carrying
 * `targetCharacterId` (no scout tap), but the hand renderer treated every
 * scoutless cancel-attack as untargeted and silently dispatched the first
 * action, so the player was never asked which character makes the influence
 * check. The grouping helper now also keys by `targetCharacterId` so those
 * cards go through the same click-the-character targeting flow.
 */

import { describe, test, expect } from 'vitest';
import type { CardInstanceId } from '@meccg/shared';
import { groupCancelAttackActionsByScout } from './cancel-attack-targets.js';

const TORMENTED_EARTH = 'p1-31' as CardInstanceId;
const FLATTER_A_FOE = 'p1-10' as CardInstanceId;
const OTHER_CARD = 'p1-32' as CardInstanceId;
const SCOUT = 'p1-98' as CardInstanceId;
const OTHER_SCOUT = 'p1-99' as CardInstanceId;

interface FakeCancelAttackAction {
  readonly cardInstanceId: CardInstanceId;
  readonly scoutInstanceId?: CardInstanceId;
  readonly targetCharacterId?: CardInstanceId;
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

  test('ignores costless cancel-attack actions with no scout and no target character', () => {
    const costless: FakeCancelAttackAction = { cardInstanceId: TORMENTED_EARTH };

    const map = groupCancelAttackActionsByScout([costless], TORMENTED_EARTH);

    expect(map.size).toBe(0);
  });

  test('groups character-targeted actions (Flatter a Foe) by targetCharacterId', () => {
    // Bug 5e858fb065b0c227: one action per company character, no scout tap —
    // each must land under its own character so the player picks who makes
    // the influence check instead of the first action firing silently.
    const forScout: FakeCancelAttackAction = { cardInstanceId: FLATTER_A_FOE, targetCharacterId: SCOUT };
    const forOtherScout: FakeCancelAttackAction = { cardInstanceId: FLATTER_A_FOE, targetCharacterId: OTHER_SCOUT };

    const map = groupCancelAttackActionsByScout([forScout, forOtherScout], FLATTER_A_FOE);

    expect(map.get(SCOUT as string)).toEqual([forScout]);
    expect(map.get(OTHER_SCOUT as string)).toEqual([forOtherScout]);
  });

  test('keys by the scout when an action names both a scout and a target character', () => {
    // The scout is what the player clicks to pay the cost; the target rides along.
    const both: FakeCancelAttackAction = {
      cardInstanceId: FLATTER_A_FOE,
      scoutInstanceId: SCOUT,
      targetCharacterId: OTHER_SCOUT,
    };

    const map = groupCancelAttackActionsByScout([both], FLATTER_A_FOE);

    expect(map.get(SCOUT as string)).toEqual([both]);
    expect(map.has(OTHER_SCOUT as string)).toBe(false);
  });

  test('keeps separate scouts in separate groups', () => {
    const forScout: FakeCancelAttackAction = { cardInstanceId: TORMENTED_EARTH, scoutInstanceId: SCOUT };
    const forOtherScout: FakeCancelAttackAction = { cardInstanceId: TORMENTED_EARTH, scoutInstanceId: OTHER_SCOUT };

    const map = groupCancelAttackActionsByScout([forScout, forOtherScout], TORMENTED_EARTH);

    expect(map.get(SCOUT as string)).toEqual([forScout]);
    expect(map.get(OTHER_SCOUT as string)).toEqual([forOtherScout]);
  });
});
