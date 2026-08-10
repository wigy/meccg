/**
 * @module forge-master-granted-action-menu.test
 *
 * Regression test for bug report 94ff7f6a05d6c32f (game msnfzusi-73w1gh, seq
 * 279): "Using The Forge-Master's effect during the organization phase
 * causes the game to produce a number of 'Forge-Place-Item' buttons ...
 * there is no way to tell what item will be placed when you click a
 * 'Forge-Place-Item' button. Nor is there a choice of which character in
 * the company to give the item to."
 *
 * Root cause: the organization-phase legal-action computer already emits one
 * `activate-granted-action` per (item, recipient) candidate pair for The
 * Forge-master's (wh-117) `place-item-on-character` grant — the choice was
 * always there. But `buildGrantedActionMenuItems` (company-modals.ts) only
 * disambiguated same-`actionId` entries by the *acting* character's name,
 * which is identical across every Forge-master entry (the bearer who taps).
 * With no other disambiguation, every menu button rendered the same bare
 * `forge-place-item` label.
 *
 * Fix: when entries share an `actionId` and carry `targetCardId` /
 * `recipientCharacterId`, label each with the fetched item's name and the
 * recipient's name instead of the (identical) acting character's name.
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
  test('every (item, recipient) entry gets a distinct, informative label', () => {
    const items = buildGrantedActionMenuItems(actions, () => {}, resolveName);
    const labels = items.map(i => i.label);

    // Distinct: no two of the four combinations render the same button text.
    expect(new Set(labels).size).toBe(4);

    // Each label names both the fetched item and the recipient — not just the
    // (identical) acting character.
    expect(labels[0]).toContain('Dagger of Westernesse');
    expect(labels[0]).toContain('Lugdush');
    expect(labels[1]).toContain('Dagger of Westernesse');
    expect(labels[1]).toContain('Alatar');
    expect(labels[2]).toContain('Horn of Anor');
    expect(labels[2]).toContain('Lugdush');
    expect(labels[3]).toContain('Horn of Anor');
    expect(labels[3]).toContain('Alatar');
  });

  test('without a resolveName lookup, entries fall back to the bare actionId (no crash)', () => {
    const items = buildGrantedActionMenuItems(actions, () => {});
    expect(items).toHaveLength(4);
    for (const item of items) expect(item.label).toBe('forge-place-item');
  });
});
