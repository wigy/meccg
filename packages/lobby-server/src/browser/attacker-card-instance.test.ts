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
import type { AttackSource, CardDefinitionId, CardInstanceId, CompanyId } from '@meccg/shared';
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

  // The single-card variants below were all added to `AttackSource` after the
  // ahunt/great-hunt fixes and were left falling through the switch's `default`
  // to null, so their attacks rendered an empty attacker slot on the combat
  // board. `siege-attack` is the clearest: combat-view.ts already groups it
  // with `card-triggered-attack` for the attacker race label, but only
  // `card-triggered-attack` produced an image. Each must resolve to the one
  // card that represents its attack.

  test('resolves a siege-attack to the besieging card in play', () => {
    const cardInstanceId = 'p2-40' as CardInstanceId; // tw-87, Siege
    const attackSource: AttackSource = {
      type: 'siege-attack', cardInstanceId, siteInstanceId: 'p1-3' as CardInstanceId,
    };
    expect(resolveAttackerCardInstanceId(attackSource)).toBe(cardInstanceId);
  });

  test('resolves a company-strike-event to the played short-event', () => {
    const eventInstanceId = 'p2-51' as CardInstanceId; // td-9, Cruel Caradhras
    const attackSource: AttackSource = { type: 'company-strike-event', eventInstanceId };
    expect(resolveAttackerCardInstanceId(attackSource)).toBe(eventInstanceId);
  });

  test('resolves a site-entry-attack to the in-play hazard card', () => {
    const eventInstanceId = 'p2-52' as CardInstanceId; // dm-51, Doubled Vigilance
    const attackSource: AttackSource = { type: 'site-entry-attack', eventInstanceId };
    expect(resolveAttackerCardInstanceId(attackSource)).toBe(eventInstanceId);
  });

  test('resolves a region-shortcut-attack to the triggering short-event', () => {
    const eventInstanceId = 'p1-70' as CardInstanceId;
    const attackSource: AttackSource = {
      type: 'region-shortcut-attack', eventInstanceId, companyId: 'c1' as CompanyId,
    };
    expect(resolveAttackerCardInstanceId(attackSource)).toBe(eventInstanceId);
  });

  test('resolves a traitor-attack to the Traitor card that fired', () => {
    const eventInstanceId = 'p2-60' as CardInstanceId; // tw-105, Traitor
    const attackSource: AttackSource = {
      type: 'traitor-attack', eventInstanceId, traitorDefinitionId: 'tw-13' as CardDefinitionId,
    };
    expect(resolveAttackerCardInstanceId(attackSource)).toBe(eventInstanceId);
  });

  test('resolves a hunt-attack to the attacking creature instance', () => {
    const creatureInstanceId = 'p2-93' as CardInstanceId;
    const attackSource: AttackSource = {
      type: 'hunt-attack',
      huntInstanceId: 'p1-88' as CardInstanceId, // dm-143, The Hunt
      creatureInstanceId,
      bearerInstanceId: 'p1-5' as CardInstanceId,
    };
    expect(resolveAttackerCardInstanceId(attackSource)).toBe(creatureInstanceId);
  });

  test('resolves a long-dark-reach-attack to the named creature instance', () => {
    const creatureInstanceId = 'p1-94' as CardInstanceId;
    const attackSource: AttackSource = {
      type: 'long-dark-reach-attack',
      sourceInstanceId: 'p1-89' as CardInstanceId, // dm-70, Long Dark Reach
      creatureInstanceId,
    };
    expect(resolveAttackerCardInstanceId(attackSource)).toBe(creatureInstanceId);
  });

  test('resolves a stay-her-appetite-attack to the attacking ally', () => {
    const allyInstanceId = 'p1-30' as CardInstanceId;
    const attackSource: AttackSource = {
      type: 'stay-her-appetite-attack',
      eventDefinitionId: 'le-140' as CardDefinitionId,
      allyInstanceId,
      allyOwnerPlayerIndex: 0,
      hostCharacterInstanceId: 'p1-5' as CardInstanceId,
    };
    expect(resolveAttackerCardInstanceId(attackSource)).toBe(allyInstanceId);
  });

  test('returns null for sources rendered specially (e.g. automatic-attack)', () => {
    const attackSource: AttackSource = { type: 'automatic-attack', siteInstanceId: 'p1-1' as CardInstanceId, attackIndex: 0 };
    expect(resolveAttackerCardInstanceId(attackSource)).toBeNull();
  });

  test('returns null for a CvCC company-attack (rendered as character columns)', () => {
    const attackSource: AttackSource = { type: 'company-attack', attackingCompanyId: 'c2' as CompanyId };
    expect(resolveAttackerCardInstanceId(attackSource)).toBeNull();
  });

  test('returns null for Lucky Search, which has no single attacker card', () => {
    const attackSource: AttackSource = {
      type: 'lucky-search-attack',
      scoutInstanceId: 'p1-5' as CardInstanceId,
      foundItemInstanceId: null,
      revealedCardInstanceIds: [],
    };
    expect(resolveAttackerCardInstanceId(attackSource)).toBeNull();
  });
});
