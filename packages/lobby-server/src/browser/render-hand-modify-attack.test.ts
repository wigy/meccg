/**
 * @module render-hand-modify-attack.test
 *
 * Regression test for bug report 9be04a9d686518f6 (game mtudgfvh-03ugs3, seq
 * 714): the hazard player held Morgul-knife (tw-64), a from-hand
 * `modify-attack` hazard event played reactively during the pre-assignment
 * window of a Nazgûl attack (`fromHand: true`, no `characterInstanceId`).
 * `computeLegalActions` correctly offered the `modify-attack` action, but
 * nothing in `render-hand.ts` ever checked for the `modify-attack` action
 * type when deciding whether a hand card was clickable — every other action
 * type (cancel-attack, play-short-event, play-hazard, ...) has a dedicated
 * finder, but from-hand modify-attack cards (Morgul-knife, Dragon's
 * Desolation tw-29, Forewarned tw-346) had none, so the card never became
 * selectable.
 *
 * `findModifyAttackActions` now identifies exactly those `modify-attack`
 * actions played from a hand card (no `characterInstanceId`), as opposed to
 * an in-play item/ally activation, which is rendered by clicking the item on
 * the combat board instead.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction, ModifyAttackAction, PlayerId } from '@meccg/shared';
import { findModifyAttackActions } from './render-hand.js';

const MORGUL_KNIFE = 'p1-67' as CardInstanceId;
const BLACK_ARROW_ITEM = 'p2-10' as CardInstanceId;
const WITCH_KING_CHAR = 'p2-1' as CardInstanceId;
const P1 = 'p1' as PlayerId;
const P2 = 'p2' as PlayerId;

function handModifyAttack(cardInstanceId: CardInstanceId): ModifyAttackAction {
  return { type: 'modify-attack', player: P1, cardInstanceId };
}

function itemModifyAttack(cardInstanceId: CardInstanceId, characterInstanceId: CardInstanceId): ModifyAttackAction {
  return { type: 'modify-attack', player: P2, cardInstanceId, characterInstanceId };
}

describe('findModifyAttackActions (Morgul-knife: from-hand modify-attack during a Nazgûl attack)', () => {
  test('includes a from-hand modify-attack action for the matching hand card', () => {
    const actions: GameAction[] = [handModifyAttack(MORGUL_KNIFE)];
    expect(findModifyAttackActions(MORGUL_KNIFE, actions)).toEqual([handModifyAttack(MORGUL_KNIFE)]);
  });

  test('excludes an in-play item modify-attack action (already has its own click target)', () => {
    const actions: GameAction[] = [itemModifyAttack(BLACK_ARROW_ITEM, WITCH_KING_CHAR)];
    expect(findModifyAttackActions(BLACK_ARROW_ITEM, actions)).toEqual([]);
  });

  test('returns nothing for a null instance id', () => {
    expect(findModifyAttackActions(null, [handModifyAttack(MORGUL_KNIFE)])).toEqual([]);
  });
});
