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
 *
 * Also covers bug report "The Great Hunt" (game mskidoss-noauyv, seq 1228):
 * a creature revealed and attacking via The Great Hunt (wh-91) likewise
 * showed no card — `{ type: 'great-hunt-attack', creatureInstanceId, ... }`
 * fell through the same switch with no branch, hiding the (already publicly
 * revealed) attacking creature's identity from the defending player.
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

  test('resolves a great-hunt-attack to the revealed creature instance', () => {
    const creatureInstanceId = 'p2-93' as CardInstanceId; // tw-37, revealed via The Great Hunt
    const attackSource: AttackSource = {
      type: 'great-hunt-attack',
      greatHuntInstanceId: 'p1-88' as CardInstanceId, // wh-91
      creatureInstanceId,
      continuation: 'reveal',
    };
    expect(resolveAttackerCardInstanceId(attackSource)).toBe(creatureInstanceId);
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
