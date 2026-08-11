/**
 * @module engine/follower-dispersal
 *
 * Shared handling for the followers of a character that leaves play.
 *
 * CoE 2.II.2.2.3: when a character with followers is removed (discarded,
 * eliminated, returned to hand, or successfully influenced away), each of its
 * followers reverts to the controller's general influence, but its mind is
 * *not* immediately subtracted — the follower stays in play, uncontrolled,
 * until its player's next organization phase, at which point it must be
 * reassigned (general or direct influence) or discarded (CoE 3.47 overflow).
 * This mirrors the identical deferral already used for mid-combat controller
 * loss (combat-finalize.ts et al.) and for a direct-influence shortfall
 * discovered during organization (reducer-organization.ts's
 * `revertOverextendedDirectInfluenceFollowers`) — the rule does not
 * distinguish *why* the controller left, so the follower is never discarded
 * on the spot regardless of whether general influence currently has room for
 * it.
 */

import type { GameState, CharacterInPlay, CardInstanceId } from '../index.js';
import { ringwraithReclaimMark } from './reducer-utils.js';
import { logDetail } from './legal-actions/log.js';

/**
 * Disperse the followers of a character leaving play: each follower reverts
 * to general influence with the mind subtraction deferred (`influenceUnsubtracted:
 * true`) rather than being discarded, per CoE 2.II.2.2.3. A follower is also
 * stamped via {@link ringwraithReclaimMark} — a Ringwraith avatar played as a
 * follower cannot actually be controlled by general influence (CoE 3.08), so
 * this starts its reclaim grace period instead.
 *
 * `characters` is the caller's *working copy* of the player's character map
 * (still containing `removedCharacter`) and is mutated in place: each
 * follower is re-tagged `controlledBy: 'general'`.
 */
export function freeOrDiscardFollowers(
  state: GameState,
  characters: Record<CardInstanceId, CharacterInPlay>,
  removedCharacter: CharacterInPlay,
  logPrefix: string,
): void {
  for (const followerId of removedCharacter.followers) {
    const follower = characters[followerId];
    if (!follower) continue;
    characters[followerId] = {
      ...follower,
      controlledBy: 'general',
      influenceUnsubtracted: true,
      ...ringwraithReclaimMark(state, follower),
    };
    logDetail(`${logPrefix}: follower ${followerId as string} reverts to general influence, deferred (CoE 2.II.2.2.3)`);
  }
}
