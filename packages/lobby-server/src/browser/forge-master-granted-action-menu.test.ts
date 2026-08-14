/**
 * @module forge-master-granted-action-menu.test
 *
 * Regression tests for two bug reports about The Forge-master's (wh-117)
 * `forge-place-item` grant-action menu, which the organization-phase
 * legal-action computer emits as one `activate-granted-action` per (item,
 * recipient) candidate pair:
 *
 * - 94ff7f6a05d6c32f (game msnfzusi-73w1gh, seq 279): every entry rendered
 *   the same bare `forge-place-item` label — `buildGrantedActionMenuItems`
 *   only disambiguated same-`actionId` entries by the *acting* character's
 *   name, which is identical across every Forge-master entry (the bearer
 *   who taps). Fixed by labeling each entry with the fetched item's name
 *   and the recipient's name instead.
 * - db6910ae7bc65e25 (game mst6nid7-0t6edg, seq 865): even with distinct
 *   labels, flattening the full (item × recipient) cross product produced
 *   far more buttons than fit on screen, with no way to scroll (7 items ×
 *   4 recipients = 28 buttons). Fixed by narrowing entries that vary over
 *   *both* dimensions into a two-step picker: one top-level entry per item,
 *   each with a `children` submenu of that item's recipients.
 */

import './test-dom-bootstrap.js'; // must precede the company-modals import (load-time window access)
import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { ActivateGrantedAction, CardDefinitionId, CardInstanceId, PlayerId } from '@meccg/shared';
import { buildGrantedActionMenuItems } from './company-modals.js';

const pool = loadCardPool();

const FORGE_MASTER = 'p1-1' as CardInstanceId; // wh-117, source card
const BEARER = 'p1-2' as CardInstanceId; // wh-5 Ill-favoured Fellow, taps to activate
const DAGGER = 'p1-3' as CardInstanceId; // tw-206 Dagger of Westernesse, fetched item candidate
const HORN = 'p1-4' as CardInstanceId; // tw-259 Horn of Anor, fetched item candidate
const RECIPIENT_A = 'p1-5' as CardInstanceId; // wh-6 Lugdush
const RECIPIENT_B = 'p1-6' as CardInstanceId; // wh-1 Alatar

const DEF_BY_INSTANCE: Readonly<Record<string, CardDefinitionId>> = {
  [FORGE_MASTER]: 'wh-117' as CardDefinitionId,
  [BEARER]: 'wh-5' as CardDefinitionId,
  [DAGGER]: 'tw-206' as CardDefinitionId,
  [HORN]: 'tw-259' as CardDefinitionId,
  [RECIPIENT_A]: 'wh-6' as CardDefinitionId,
  [RECIPIENT_B]: 'wh-1' as CardDefinitionId,
};

const resolveName = (id: CardInstanceId): string | undefined => {
  const defId = DEF_BY_INSTANCE[id as string];
  return defId ? pool[defId as string]?.name : undefined;
};

/** One `activate-granted-action` per (item, recipient) candidate pair, as emitted by organization.ts. */
const forgeAction = (targetCardId: CardInstanceId, recipientCharacterId: CardInstanceId): ActivateGrantedAction => ({
  type: 'activate-granted-action',
  player: 'p1' as PlayerId,
  characterId: BEARER,
  sourceCardId: FORGE_MASTER,
  sourceCardDefinitionId: 'wh-117' as CardDefinitionId,
  actionId: 'forge-place-item',
  rollThreshold: 0,
  targetCardId,
  recipientCharacterId,
});

const actions: ActivateGrantedAction[] = [
  forgeAction(DAGGER, RECIPIENT_A),
  forgeAction(DAGGER, RECIPIENT_B),
  forgeAction(HORN, RECIPIENT_A),
  forgeAction(HORN, RECIPIENT_B),
];

describe('Forge-master grant-action menu labels (bug 94ff7f6a05d6c32f)', () => {
  test('one top-level entry per item, each naming the item and opening a recipient submenu', () => {
    const items = buildGrantedActionMenuItems(actions, () => {}, resolveName);

    // Two items × two recipients collapses to two top-level (item) entries,
    // not four flat (item, recipient) entries.
    expect(items).toHaveLength(2);
    const labels = items.map(i => i.label);
    expect(labels.some(l => l.includes('Dagger of Westernesse'))).toBe(true);
    expect(labels.some(l => l.includes('Horn of Anor'))).toBe(true);

    for (const item of items) {
      expect(item.children).toHaveLength(2);
      const childLabels = item.children?.map(c => c.label) ?? [];
      expect(childLabels).toContain('to Lugdush');
      expect(childLabels).toContain('to Alatar');
    }
  });

  test('picking item then recipient dispatches the matching (item, recipient) action', () => {
    const dispatched: ActivateGrantedAction[] = [];
    const items = buildGrantedActionMenuItems(actions, a => dispatched.push(a as ActivateGrantedAction), resolveName);

    const daggerEntry = items.find(i => i.label.includes('Dagger of Westernesse'));
    const toAlatar = daggerEntry?.children?.find(c => c.label === 'to Alatar');
    toAlatar?.onClick?.();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].targetCardId).toBe(DAGGER);
    expect(dispatched[0].recipientCharacterId).toBe(RECIPIENT_B);
  });

  test('without a resolveName lookup, entries fall back to the bare actionId, flat (no crash)', () => {
    const items = buildGrantedActionMenuItems(actions, () => {});
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(item.label).toBe('forge-place-item');
      expect(item.children).toBeUndefined();
    }
  });
});

describe('Forge-master grant-action menu button count (bug db6910ae7bc65e25)', () => {
  test('a large item x recipient cross product narrows to one button per item, not the full cross product', () => {
    const items_ = [DAGGER, HORN, 'p1-7' as CardInstanceId, 'p1-8' as CardInstanceId, 'p1-9' as CardInstanceId, 'p1-10' as CardInstanceId, 'p1-11' as CardInstanceId];
    const recipients = [RECIPIENT_A, RECIPIENT_B, 'p1-12' as CardInstanceId, 'p1-13' as CardInstanceId];
    const defByInstance: Record<string, CardDefinitionId> = { ...DEF_BY_INSTANCE };
    for (const id of items_) defByInstance[id as string] ??= 'tw-206' as CardDefinitionId;
    for (const id of recipients) defByInstance[id as string] ??= 'wh-6' as CardDefinitionId;
    const resolve = (id: CardInstanceId): string | undefined => {
      const defId = defByInstance[id as string];
      return defId ? pool[defId as string]?.name : undefined;
    };

    const many: ActivateGrantedAction[] = [];
    for (const itemId of items_) {
      for (const recipientId of recipients) many.push(forgeAction(itemId, recipientId));
    }
    expect(many).toHaveLength(28); // matches the reported 7 items x 4 recipients

    const menuItems = buildGrantedActionMenuItems(many, () => {}, resolve);

    // One top-level button per distinct item, not one per (item, recipient) pair.
    expect(menuItems).toHaveLength(items_.length);
    for (const item of menuItems) expect(item.children).toHaveLength(recipients.length);
  });
});
