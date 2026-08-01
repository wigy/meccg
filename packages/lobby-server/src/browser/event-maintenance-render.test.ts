/**
 * @module event-maintenance-render.test
 *
 * Regression test for bug report fc2f6484500c88f1 (game msa6jumm-uefcuj, seq
 * 1062): "AI now hangs." Thrice Outnumbered (le-142) fired its
 * `opponent-long-event-end` maintenance trigger, enqueuing a
 * `pay-event-maintenance` resolution for its controller. The engine was
 * correct — the controller's legal actions correctly listed
 * `discard-self`/`discard-from-hand` options — but the normal board view gave
 * the player no way to act on them: `renderPassButton`'s whitelist doesn't
 * cover `pay-event-maintenance` (it needs a card-name choice, not a single
 * click), and the cards-in-play row rendered the maintained permanent as a
 * plain, unclickable image. With no button and no highlighted card, the
 * screen showed nothing at all — indistinguishable from a frozen opponent.
 *
 * `findEventMaintenanceActions` now surfaces the pending stage's actions for
 * the maintained permanent so the cards-in-play renderer can wire a click
 * handler (single action fires immediately; several open a tooltip menu, one
 * item per option), matching the click-to-open-menu pattern used for the
 * Lidless Eye's bearer-less granted actions.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { CardInstanceId, CardDefinitionId, PayEventMaintenanceAction } from '@meccg/shared';
import { findEventMaintenanceActions, eventMaintenanceActionLabel } from './company-block.js';
import { setCachedInstanceLookup } from './company-view-state.js';

const pool = loadCardPool();

const THRICE_OUTNUMBERED = 'p1-58' as CardInstanceId; // le-142, the maintained permanent
const LAWLESS_MEN = 'p1-47' as CardInstanceId; // le-82, a matching hand card
const OTHER_PERMANENT = 'p1-99' as CardInstanceId;

const discardSelfAction: PayEventMaintenanceAction = {
  type: 'pay-event-maintenance',
  player: 'p1',
  paymentType: 'discard-self',
  cardInstanceId: THRICE_OUTNUMBERED,
  sourceInstanceId: THRICE_OUTNUMBERED,
} as PayEventMaintenanceAction;

const discardFromHandAction: PayEventMaintenanceAction = {
  type: 'pay-event-maintenance',
  player: 'p1',
  paymentType: 'discard-from-hand',
  cardInstanceId: LAWLESS_MEN,
  sourceInstanceId: THRICE_OUTNUMBERED,
} as PayEventMaintenanceAction;

const declineAction: PayEventMaintenanceAction = {
  type: 'pay-event-maintenance',
  player: 'p1',
  paymentType: 'decline',
  cardInstanceId: THRICE_OUTNUMBERED,
  sourceInstanceId: THRICE_OUTNUMBERED,
} as PayEventMaintenanceAction;

describe('findEventMaintenanceActions surfaces the upkeep choice on the maintained permanent', () => {
  test('returns every action keyed to that source instance', () => {
    expect(
      findEventMaintenanceActions([discardSelfAction, discardFromHandAction], THRICE_OUTNUMBERED),
    ).toEqual([discardSelfAction, discardFromHandAction]);
  });

  test('returns nothing for an unrelated permanent or an empty action list', () => {
    expect(findEventMaintenanceActions([discardSelfAction], OTHER_PERMANENT)).toEqual([]);
    expect(findEventMaintenanceActions([], THRICE_OUTNUMBERED)).toEqual([]);
  });
});

describe('eventMaintenanceActionLabel names the actual choice, not a raw id', () => {
  const sourceName = pool['le-142' as CardDefinitionId]?.name ?? 'Thrice Outnumbered';

  test('labels discard-self with the maintained card\'s name', () => {
    expect(eventMaintenanceActionLabel(discardSelfAction, sourceName, pool)).toBe(`Discard ${sourceName}`);
  });

  test('labels decline plainly', () => {
    expect(eventMaintenanceActionLabel(declineAction, sourceName, pool)).toBe('Decline');
  });

  test('labels discard-from-hand with the paid hand card\'s resolved name', () => {
    setCachedInstanceLookup((id: CardInstanceId): CardDefinitionId | undefined =>
      (id === LAWLESS_MEN ? ('le-82' as CardDefinitionId) : undefined));
    const handName = pool['le-82' as CardDefinitionId]?.name ?? 'Lawless Men';
    expect(eventMaintenanceActionLabel(discardFromHandAction, sourceName, pool)).toBe(`Discard ${handName} from hand`);
  });
});
