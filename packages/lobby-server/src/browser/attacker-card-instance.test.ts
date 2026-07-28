/**
 * @module attacker-card-instance.test
 *
 * Regression test for bug report "Earcaraxe" (game ms4knxxm-yjvsvt, seq 812):
 * an Eärcaraxë Ahunt (td-21) dragon attack showed no card on the combat
 * board. `combat.attackSource` was `{ type: 'ahunt', longEventInstanceId }`,
 * but combat-view.ts's attacker-row renderer only recognized 'creature',
 * 'on-guard-creature', 'played-auto-attack', 'automatic-attack', 'agent',
 * 'card-triggered-attack', 'company-attack', and 'tidings-attack' — 'ahunt'
 * fell through with no branch, so no image was appended.
 *
 * `resolveAttackerCardInstanceId` now covers 'ahunt', resolving to the
 * long-event card instance that triggered the attack.
 */

import { describe, test, expect } from 'vitest';
import type { AttackSource, CardInstanceId } from '@meccg/shared';
import { resolveAttackerCardInstanceId } from './attacker-card-instance.js';

const AHUNT_INSTANCE = 'p1-90' as CardInstanceId; // td-21, Eärcaraxë Ahunt

describe('resolveAttackerCardInstanceId', () => {
  test('resolves an ahunt long-event attack to its card instance', () => {
    const attackSource: AttackSource = { type: 'ahunt', longEventInstanceId: AHUNT_INSTANCE };
    expect(resolveAttackerCardInstanceId(attackSource)).toBe(AHUNT_INSTANCE);
  });

  test('still resolves a creature attack (no regression)', () => {
    const instanceId = 'p2-5' as CardInstanceId;
    const attackSource: AttackSource = { type: 'creature', instanceId };
    expect(resolveAttackerCardInstanceId(attackSource)).toBe(instanceId);
  });

  test('returns null for sources rendered specially (e.g. automatic-attack)', () => {
    const attackSource: AttackSource = { type: 'automatic-attack', siteInstanceId: 'p1-1' as CardInstanceId, attackIndex: 0 };
    expect(resolveAttackerCardInstanceId(attackSource)).toBeNull();
  });
});
