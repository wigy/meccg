/**
 * @module attacker-card-instance
 *
 * Resolves which single card instance represents a combat's attacker, for
 * the {@link AttackSource} variants backed by exactly one card. Kept out of
 * combat-view.ts (which does DOM rendering and isn't unit-testable) so this
 * lookup can be covered by a regression test.
 */

import type { AttackSource, CardInstanceId } from '@meccg/shared';

/**
 * Returns the card instance whose image should be shown as the attacker, for
 * AttackSource types backed by a single card (creature, on-guard creature,
 * agent, card-triggered attack, ahunt long-event, etc). Returns null for
 * sources rendered specially (site automatic-attacks, CvCC, tidings-attack)
 * or with no single representative card.
 */
export function resolveAttackerCardInstanceId(attackSource: AttackSource): CardInstanceId | null {
  switch (attackSource.type) {
    case 'creature':
    case 'played-auto-attack':
    case 'agent':
      return attackSource.instanceId;
    case 'on-guard-creature':
    case 'card-triggered-attack':
      return attackSource.cardInstanceId;
    case 'ahunt':
      return attackSource.longEventInstanceId;
    default:
      return null;
  }
}
