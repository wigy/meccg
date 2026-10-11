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
 * engine's model the MP-worth test is the printed `killMarshallingPoints`,
 * unless the trophy is stamped `trophyWorthNoMarshallingPoints` (taken from a
 * detainment attack) or its starred status does not match the holder's
 * alignment (CoE 8.22) — see {@link trophyKillMarshallingPoints}.
 */

import type { GameState, CharacterInPlay, CardInstance } from '../index.js';
import { Alignment } from '../types/common.js';
import { logDetail } from './legal-actions/log.js';

/**
 * CoE rule 8.22: whether a defeated creature's kill marshalling points count
 * for a defender of `alignment` — starred (*) kill MP count only for
 * Ringwraith/Balrog players, unstarred kill MP only for everyone else.
 */
export function creatureKillMpMatchesAlignment(
  creatureDef: { starredKillMarshallingPoints?: boolean } | undefined,
  alignment: Alignment,
): boolean {
  const isStarred = creatureDef?.starredKillMarshallingPoints === true;
  const isMinion = alignment === Alignment.Ringwraith || alignment === Alignment.Balrog;
  return isMinion ? isStarred : !isStarred;
}

/**
 * The printed kill marshalling points a trophy is currently worth to a holder
 * of `alignment` (CoE 3.IV.2): zero when stamped
 * `trophyWorthNoMarshallingPoints` (detainment) or when the creature's starred
 * status does not match the holder's alignment (CoE 8.22 — e.g. an unstarred
 * Slayer held by a Ringwraith player's Orc). The alignment test is applied
 * here rather than trusted to the take-time stamp so trophies taken before
 * that stamp existed are valued correctly too. Fallen-wizard flattening is
 * left to the MP tally.
 */
export function trophyKillMarshallingPoints(
  state: GameState,
  trophy: CardInstance,
  alignment: Alignment,
): number {
  if (trophy.trophyWorthNoMarshallingPoints) return 0;
  const def = state.cardPool[trophy.definitionId];
  if (!def || !('killMarshallingPoints' in def)) return 0;
  if (!creatureKillMpMatchesAlignment(def as { starredKillMarshallingPoints?: boolean }, alignment)) return 0;
  return (def as { killMarshallingPoints: number }).killMarshallingPoints;
}

/**
 * Partition the trophies of a character leaving play into the two CoE 3.IV.4
 * destinations, both belonging to the trophy-holder's *own* player:
 *
 * - `toKillPile` — trophies still worth marshalling points to the holder
 *   ({@link trophyKillMarshallingPoints} > 0); they go to that player's
 *   marshalling-point pile, where the MP tally scores them again.
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
  if (!char.trophies?.length) return { toKillPile, toOutOfPlay };
  // Trophies can only be held by Orc/Troll characters of minion, Balrog or
  // Fallen-wizard players; default to Ringwraith if the holder is not found.
  const holder = state.players.find(p => p.characters[char.instanceId] !== undefined);
  const alignment = holder?.alignment ?? Alignment.Ringwraith;
  for (const trophy of char.trophies) {
    const killMp = trophyKillMarshallingPoints(state, trophy, alignment);
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
