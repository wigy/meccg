/**
 * @module concealment-ally-scout-click.test
 *
 * Regression test for bug report "Concealment" (game muvqdn6q-9vdyhz, seq 390):
 * the player wanted to tap Gollum (tw-246, a scout ally) to play Concealment
 * (tw-204, "Scout only") against a site automatic-attack. The engine correctly
 * offered `cancel-attack` with `scoutInstanceId` set to Gollum (allies count
 * as characters for "skill only" cards, CoE 2.V.2.2), but combat-view only
 * consulted `cancelAttackScoutMap` for company characters — the ally
 * attachment branch never did, so clicking Gollum with Concealment selected
 * fell through to assigning him a strike instead.
 *
 * The ally branch now looks up `cancelAttackScoutMap` by the ally's instance
 * ID. This asserts the scout grouping keys Gollum's action by his own ID,
 * which is the lookup that ally click handler relies on.
 */

import { describe, test, expect } from 'vitest';
import type { CancelAttackAction, CardInstanceId, PlayerId } from '@meccg/shared';
import { groupCancelAttackActionsByScout } from './cancel-attack-targets.js';

const CONCEALMENT = 'p1-7' as CardInstanceId;
const OTHER_CONCEALMENT = 'p1-6' as CardInstanceId;
const GOLLUM = 'p1-30' as CardInstanceId;      // ally on p1-192
const BEARER = 'p1-192' as CardInstanceId;
const OTHER_SCOUT = 'p1-194' as CardInstanceId;

const cancel = (card: CardInstanceId, scout: CardInstanceId): CancelAttackAction => ({
  type: 'cancel-attack',
  player: 'p1' as PlayerId,
  cardInstanceId: card,
  scoutInstanceId: scout,
});

// Subset of the legal actions the engine logged for p1 at seq 389.
const actions = [
  cancel(CONCEALMENT, OTHER_SCOUT),
  cancel(CONCEALMENT, BEARER),
  cancel(CONCEALMENT, GOLLUM),
  cancel(OTHER_CONCEALMENT, GOLLUM),
];

describe('Concealment can be paid by tapping a scout ally', () => {
  const map = groupCancelAttackActionsByScout(actions, CONCEALMENT);

  test('Gollum is a clickable scout target for the selected Concealment', () => {
    expect(map.get(GOLLUM as string)).toEqual([cancel(CONCEALMENT, GOLLUM)]);
  });

  test('Gollum\'s bearer keeps its own, separate scout action', () => {
    expect(map.get(BEARER as string)).toEqual([cancel(CONCEALMENT, BEARER)]);
  });
});
