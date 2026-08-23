/**
 * @module engine/trophy-dispersal
 *
 * Shared handling for the trophies of an Orc/Troll character that leaves play.
 *
 * A creature taken as a trophy (CoE 3.IV.1 / MELE §8.37) is stored *only* on
 * the bearer character's `trophies` list — it is no longer in any pile. When
 * the bearer leaves play (eliminated in combat, discarded by a failed
 * corruption check, influenced away in the site phase, etc.) its trophies must
 * be relocated, or the creature CardInstance would disappear from the game
 * state entirely (violating the hard "no card instance may ever disappear"
 * invariant — `resolveInstanceId` would then fail for it).
 *
 * CoE 3.IV.4 fixes the destination: a trophy that is *currently worth
 * marshalling points to that player* goes to the player's marshalling-point
 * pile (`killPile`, which the MP tally sums); a trophy that is *not* currently
 * worth marshalling points is removed from play (`outOfPlayPile`). In the
 * engine's model a trophy is only ever taken from the kill pile, so its
 * printed `killMarshallingPoints` is the MP-worth test.
 */

import type { GameState, CharacterInPlay, CardInstance } from '../index.js';
import { logDetail } from './legal-actions/log.js';

/**
 * Partition the trophies of a character leaving play into the two CoE 3.IV.4
 * destinations, both belonging to the trophy-holder's *own* player:
 *
 * - `toKillPile` — trophies still worth marshalling points (printed
 *   `killMarshallingPoints > 0`); they go to that player's marshalling-point
 *   pile, where the MP tally scores them again.
 * - `toOutOfPlay` — trophies worth no marshalling points; removed from play.
 *
 * Both lists are `CardInstance`s ready to append to the player's `killPile` /
 * `outOfPlayPile`. Returns empty lists for a character with no trophies.
 */
export function partitionLeavingTrophies(
  state: GameState,
  char: CharacterInPlay,
  logPrefix: string,
): { toKillPile: CardInstance[]; toOutOfPlay: CardInstance[] } {
  const toKillPile: CardInstance[] = [];
  const toOutOfPlay: CardInstance[] = [];
  for (const trophy of char.trophies ?? []) {
    const def = state.cardPool[trophy.definitionId];
    const killMp = def && 'killMarshallingPoints' in def
      ? (def as { killMarshallingPoints: number }).killMarshallingPoints
      : 0;
    if (killMp > 0) {
      logDetail(`${logPrefix}: trophy ${trophy.instanceId as string} (${killMp} MP) → marshalling-point pile (CoE 3.IV.4)`);
      toKillPile.push(trophy);
    } else {
      logDetail(`${logPrefix}: trophy ${trophy.instanceId as string} (0 MP) → removed from play (CoE 3.IV.4)`);
      toOutOfPlay.push(trophy);
    }
  }
  return { toKillPile, toOutOfPlay };
}
