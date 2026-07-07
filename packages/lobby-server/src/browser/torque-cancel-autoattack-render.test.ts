/**
 * @module torque-cancel-autoattack-render.test
 *
 * Regression test for bug report "Torque of Hues" (game mr9jvlnw-2ldyce, seq 413):
 * a company facing a site automatic-attack could not tap Torque of Hues (tw-351)
 * to cancel it. The engine correctly OFFERS the `cancel-attack` action for the
 * item against the auto-attack (verified against the game log), but the combat
 * renderer never made the item clickable: `companyInPlayIds` was built from the
 * company's characters and allies only — items were omitted — so the item's
 * `cancel-attack` action (keyed by the item's instanceId) never entered
 * `cancelAttackInPlayMap` and the item element got no click handler.
 *
 * `inPlayCancelAttackIds` now also collects each character's equipped items, so
 * an item-borne `cancel-attack` (Torque of Hues, Helm of Fear, Star-glass) is
 * surfaced as a tappable board card for every attack type, auto-attacks included.
 */

import { describe, test, expect } from 'vitest';
import type { CardInstanceId, CancelAttackAction } from '@meccg/shared';
import { inPlayCancelAttackIds } from './cancel-attack-targets.js';

const BEARER = 'p1-113' as CardInstanceId;   // character bearing the Torque
const TORQUE = 'p1-30' as CardInstanceId;    // tw-351, equipped item with cancel-attack
const OTHER_ITEM = 'p1-118' as CardInstanceId;
const ALLY = 'p1-200' as CardInstanceId;
const OTHER_CHAR = 'p1-107' as CardInstanceId;

// Mirrors the defending company's `characters` map at seq 413 of the reported game.
const charMap = {
  [BEARER as string]: {
    items: [{ instanceId: OTHER_ITEM }, { instanceId: TORQUE }],
    allies: [{ instanceId: ALLY }],
  },
  [OTHER_CHAR as string]: { items: [], allies: [] },
} as Record<string, {
  readonly items: readonly { readonly instanceId: CardInstanceId }[];
  readonly allies: readonly { readonly instanceId: CardInstanceId }[];
}>;

describe('item-borne cancel-attack is surfaced against an automatic-attack', () => {
  const ids = inPlayCancelAttackIds([BEARER, OTHER_CHAR], charMap);

  test('the equipped Torque of Hues item is an eligible in-play cancel target', () => {
    expect(ids.has(TORQUE as string)).toBe(true);
  });

  test('characters and allies remain eligible', () => {
    expect(ids.has(BEARER as string)).toBe(true);
    expect(ids.has(OTHER_CHAR as string)).toBe(true);
    expect(ids.has(ALLY as string)).toBe(true);
  });

  test('the item cancel-attack action keys into the in-play map (renderer step)', () => {
    // The engine emits this action for Torque against the site auto-attack.
    const torqueCancel: CancelAttackAction = {
      type: 'cancel-attack',
      player: 'p1',
      cardInstanceId: TORQUE,
    } as CancelAttackAction;

    // Replicates combat-view's cancelAttackInPlayMap construction.
    const map = new Map<string, CancelAttackAction>();
    for (const a of [torqueCancel]) {
      if (!a.scoutInstanceId && ids.has(a.cardInstanceId as string)) {
        map.set(a.cardInstanceId as string, a);
      }
    }
    expect(map.get(TORQUE as string)).toBe(torqueCancel);
  });
});
