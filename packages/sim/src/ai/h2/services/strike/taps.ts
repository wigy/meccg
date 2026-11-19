/**
 * @module ai/h2/services/strike/taps
 *
 * What a site's automatic attacks leave of a company's taps — shared by
 * `travel` (is the site worth entering?) and `organization` (can this roster
 * serve a goal there at all?).
 */

import { CardStatus } from '@meccg/shared';
import type { StrikeTarget } from './prowess.js';
import type { AttackProfile } from './sequence.js';

/**
 * How many of a company's untapped characters are still untapped once a
 * site's automatic attacks have been faced — the taps left to play what the
 * site unlocks.
 *
 * A character who faces a strike taps to fight it unless he can afford the −3
 * for staying untapped (CoE 3.iv), and the attacker assigns whatever strikes
 * the defender leaves over, so every strike lands on an untapped character
 * while one remains. Without this, a lone Boromir II at The Lonely Mountain
 * priced his Enruned Shield as playable behind the Dragon's single strike —
 * but the only character who could tap for it had to tap to face the Dragon
 * first, so entering was all risk and no reward (game mvj4blbj-kkinem,
 * turn 64).
 *
 * The defender puts his strongest characters up first, and one of them keeps
 * his tap only if even the lowest roll (2) at −3 prowess cannot lose the
 * strike. Each attack is a fresh assignment (one strike per character per
 * attack), but a character tapped by an earlier attack stays tapped.
 */
export function untappedAfterAttacks(
  roster: readonly StrikeTarget[],
  attacks: readonly AttackProfile[],
): number {
  let untapped = roster
    .filter(t => !t.isAlly && t.status === CardStatus.Untapped)
    .map(t => t.prowess)
    .sort((a, b) => b - a);
  for (const attack of attacks) {
    const facing = untapped.slice(0, attack.strikes);
    const keepsTap = facing.filter(prowess => prowess - 3 + 2 >= attack.strikeProwess);
    untapped = [...keepsTap, ...untapped.slice(attack.strikes)].sort((a, b) => b - a);
  }
  return untapped.length;
}
