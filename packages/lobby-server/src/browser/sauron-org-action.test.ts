/**
 * @module sauron-org-action.test
 *
 * Regression test for bug report f686574021c72381 (game ms1ut2yf-ndju07, seq
 * 42): Sauron (ba-43) "should be highlighted when there are actions available".
 *
 * Sauron sat in the minion player's `cardsInPlay` and the engine correctly
 * offered its organization-phase ability as `activate-granted-action`
 * (`sauron-sideboard-fetch`, one action per eligible sideboard card — the player
 * eventually brought Baduila dm-2 into the play deck). But the cards-in-play row
 * rendered the permanent as a plain image: `getGrantedActions` was only threaded
 * into company blocks, so a bearer-less in-play source got no glow and no click
 * handler, and the ability was reachable only from the debug action panel.
 *
 * `findInPlayGrantedActions` now resolves the activations granted by a board
 * card so the renderer can highlight it, and `groupGrantedActionsByAbility`
 * collapses the per-candidate actions into one menu entry per ability (the
 * candidates are then picked from a card grid instead of a list of identical
 * menu labels). This test asserts both.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { ActivateGrantedAction, CardInstanceId, GameAction } from '@meccg/shared';
import { findInPlayGrantedActions } from './company-block.js';
import { groupGrantedActionsByAbility } from './company-modals.js';

const SAURON = 'p1-22' as CardInstanceId; // ba-43, in play as a permanent-event
const OTHER_PERMANENT = 'p1-31' as CardInstanceId;
const BADUILA = 'p1-97' as CardInstanceId; // dm-2, the sideboard character actually fetched
const BEORNING_SKIN_CHANGERS = 'p1-86' as CardInstanceId; // ba-10, another eligible sideboard card
const ORC_QUARRELS = 'p1-20' as CardInstanceId; // le-216, a hand card (peek-hand discard cost)

/** Sauron has no activating character, so `characterId` self-references the source. */
const fetch = (targetCardId: CardInstanceId): ActivateGrantedAction => ({
  type: 'activate-granted-action',
  player: 'p1',
  characterId: SAURON,
  sourceCardId: SAURON,
  sourceCardDefinitionId: 'ba-43',
  actionId: 'sauron-sideboard-fetch',
  rollThreshold: 0,
  targetCardId,
} as ActivateGrantedAction);

const peek: ActivateGrantedAction = {
  type: 'activate-granted-action',
  player: 'p1',
  characterId: SAURON,
  sourceCardId: SAURON,
  sourceCardDefinitionId: 'ba-43',
  actionId: 'sauron-peek-hand',
  rollThreshold: 0,
  targetCardId: ORC_QUARRELS,
} as ActivateGrantedAction;

const actions: GameAction[] = [fetch(BADUILA), fetch(BEORNING_SKIN_CHANGERS), peek];

describe('Sauron\'s organization-phase ability is reachable from the board', () => {
  test('resolves every granted activation whose source is the clicked in-play card', () => {
    expect(findInPlayGrantedActions(actions, SAURON)).toEqual(actions);
  });

  test('no granted actions for an unrelated in-play card', () => {
    expect(findInPlayGrantedActions(actions, OTHER_PERMANENT)).toEqual([]);
    expect(findInPlayGrantedActions([], SAURON)).toEqual([]);
  });

  test('the per-candidate actions collapse into one menu entry per ability', () => {
    const groups = groupGrantedActionsByAbility(findInPlayGrantedActions(actions, SAURON));
    expect(groups.map(g => g[0].actionId)).toEqual(['sauron-sideboard-fetch', 'sauron-peek-hand']);
    // Both sideboard candidates stay in the fetch group so the card picker can
    // show them; the peek group carries its single hand-card cost.
    expect(groups[0].map(a => a.targetCardId)).toEqual([BADUILA, BEORNING_SKIN_CHANGERS]);
    expect(groups[1].map(a => a.targetCardId)).toEqual([ORC_QUARRELS]);
  });
});
