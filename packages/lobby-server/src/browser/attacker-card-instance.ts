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
 * agent, card-triggered attack, ahunt long-event, etc). Returns null only for
 * the sources rendered specially by {@link renderAttackerRow}'s own fallback
 * branches — site automatic-attacks, CvCC company attacks, and tidings-attack —
 * and for Lucky Search, whose deck-search "attack" has no single representative
 * card (its `scoutInstanceId` is the defender facing the attack, not an
 * attacker to show).
 *
 * Every other variant carries exactly one card that represents the attack —
 * the besieging or triggering card in play, the played short-event, or the
 * creature named from a pile — and must resolve to it. A missing case here
 * renders an empty attacker slot on the combat board, the defect fixed for
 * `ahunt` and `great-hunt-attack` and, before that, hiding a publicly-revealed
 * attacker's identity from the defender. When the resolved instance is not in
 * the viewing seat's projection (a creature still sitting in the opponent's
 * pile, say) the caller simply appends no image — the same, safe, status-quo
 * outcome as returning null, never a crash.
 */
export function resolveAttackerCardInstanceId(attackSource: AttackSource): CardInstanceId | null {
  switch (attackSource.type) {
    case 'creature':
    case 'played-auto-attack':
    case 'agent':
      return attackSource.instanceId;
    case 'on-guard-creature':
    case 'card-triggered-attack':
    case 'siege-attack':
      return attackSource.cardInstanceId;
    case 'company-strike-event':
    case 'site-entry-attack':
    case 'region-shortcut-attack':
    case 'traitor-attack':
      return attackSource.eventInstanceId;
    case 'ahunt':
      return attackSource.longEventInstanceId;
    case 'great-hunt-attack':
    case 'hunt-attack':
    case 'long-dark-reach-attack':
      return attackSource.creatureInstanceId;
    case 'stay-her-appetite-attack':
      return attackSource.allyInstanceId;
    default:
      return null;
  }
}
