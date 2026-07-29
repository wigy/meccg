/**
 * @module cram-transfer-vs-granted-action.test
 *
 * Regression test for bug report 57b018b8b230da24 (game ms6m2o46-1f1jcl,
 * seq 184): "Can't be transfered" — Cram (td-105).
 *
 * The engine correctly offered both a `transfer-item` action (Cram sat on a
 * character sharing a site with another character, CoE 2.II.5) and an
 * `activate-granted-action` action (Cram's own discard-for-extra-region-movement
 * ability, since the bearer's company had not yet planned movement) for the
 * same item instance at the same time. The board UI's item click handler
 * picked between "granted action" and "transfer/store" exclusively — if a
 * granted action was available it always won, so an item that was
 * simultaneously usable and transferable could never be transferred by
 * clicking it; the transfer option was silently unreachable.
 *
 * `resolveItemClick` now merges all three action families (granted, store,
 * transfer) and requires a menu whenever more than one is available, so no
 * option is ever hidden behind another.
 */

import { describe, test, expect } from 'vitest';
import type { ActivateGrantedAction, StoreItemAction, TransferItemAction, CardInstanceId, CardDefinitionId, PlayerId } from '@meccg/shared';
import { resolveItemClick } from './company-actions.js';

const PLAYER = 'p1' as PlayerId;
const CRAM = 'p1-186' as CardInstanceId; // Cram (td-105), on the bearer in the reported game
const BEARER = 'p1-181' as CardInstanceId;
const OTHER_CHARACTER = 'p1-183' as CardInstanceId;

const cramExtraMovement: ActivateGrantedAction = {
  type: 'activate-granted-action',
  player: PLAYER,
  characterId: BEARER,
  sourceCardId: CRAM,
  sourceCardDefinitionId: 'td-105' as CardDefinitionId,
  actionId: 'extra-region-movement',
  rollThreshold: 0,
};

const cramTransferToOther: TransferItemAction = {
  type: 'transfer-item',
  player: PLAYER,
  itemInstanceId: CRAM,
  fromCharacterId: BEARER,
  toCharacterId: OTHER_CHARACTER,
};

const cramStore: StoreItemAction = {
  type: 'store-item',
  player: PLAYER,
  itemInstanceId: CRAM,
  characterId: BEARER,
};

describe('resolveItemClick merges granted actions with transfer/store', () => {
  test('Cram with both a granted action and a transfer available requires a menu, not an automatic granted-action win', () => {
    const resolution = resolveItemClick([cramExtraMovement], undefined, [cramTransferToOther]);
    expect(resolution).toEqual({ kind: 'menu', optionCount: 2 });
  });

  test('all three action families at once still requires a single combined menu', () => {
    const resolution = resolveItemClick([cramExtraMovement], cramStore, [cramTransferToOther]);
    expect(resolution).toEqual({ kind: 'menu', optionCount: 3 });
  });

  test('only a granted action available still fires it directly (no regression)', () => {
    const resolution = resolveItemClick([cramExtraMovement], undefined, []);
    expect(resolution).toEqual({ kind: 'granted', action: cramExtraMovement });
  });

  test('only a transfer available still enters targeting mode directly (no regression)', () => {
    const resolution = resolveItemClick([], undefined, [cramTransferToOther]);
    expect(resolution).toEqual({ kind: 'transfer' });
  });

  test('only storing available still fires it directly (no regression)', () => {
    const resolution = resolveItemClick([], cramStore, []);
    expect(resolution).toEqual({ kind: 'store', action: cramStore });
  });

  test('no actions available yields no click handler', () => {
    const resolution = resolveItemClick([], undefined, []);
    expect(resolution).toEqual({ kind: 'none' });
  });
});
