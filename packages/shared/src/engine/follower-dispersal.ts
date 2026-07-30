/**
 * @module engine/follower-dispersal
 *
 * Shared handling for the followers of a character that leaves play.
 *
 * CoE rule: when a character with followers is removed (discarded, eliminated,
 * returned to hand, or successfully influenced away), each of its followers
 * falls under the controller's general influence *if there is room* for the
 * follower's mind; otherwise the follower is discarded along with everything
 * attached to it.
 *
 * The GI-fit check and the free-vs-discard branch are identical everywhere,
 * but the *destination piles* differ per caller (e.g. hazards attached to a
 * discarded follower may be routed to the hazard owner's discard pile, or the
 * caller may be operating on the opponent's side of the board). Callers
 * therefore supply the sinks; this module owns only the decision logic.
 */

import type { GameState, CharacterInPlay, CardInstance, CardInstanceId, PlayerId } from '../index.js';
import { printedMind } from '../types/cards.js';
import { defById, generalInfluenceControlLimit, toCardInstance } from './reducer-utils.js';
import { logDetail } from './legal-actions/log.js';

/**
 * Destination piles for cards shed by a follower that could not fall to
 * general influence. Each callback receives a plain {@link CardInstance}
 * (already converted via `toCardInstance`) and must push it into the
 * appropriate pile — no card may be dropped (no-disappear invariant).
 */
export interface FollowerDispersalSinks {
  /** Receives the follower's items, allies, and finally the follower card itself. */
  discardOwn(card: CardInstance): void;
  /** Receives hazards attached to the follower; the caller routes them to the correct owner's pile. */
  discardHazard(hazard: CardInstance): void;
}

/**
 * Disperse the followers of a character leaving play: each follower falls to
 * the controller's general influence when its printed mind still fits under
 * {@link generalInfluenceControlLimit}, and is otherwise discarded through
 * the caller-supplied sinks together with its items, allies, and hazards.
 *
 * `characters` is the caller's *working copy* of the player's character map
 * (still containing `removedCharacter`, which is excluded from the GI total)
 * and is mutated in place: freed followers are re-tagged
 * `controlledBy: 'general'`, discarded ones are deleted.
 */
export function freeOrDiscardFollowers(
  state: GameState,
  characters: Record<CardInstanceId, CharacterInPlay>,
  removedCharacter: CharacterInPlay,
  controllerId: PlayerId,
  sinks: FollowerDispersalSinks,
  logPrefix: string,
): void {
  for (const followerId of removedCharacter.followers) {
    const follower = characters[followerId];
    if (!follower) continue;
    const followerMind = printedMind(defById(state, follower.definitionId));

    const currentGIUsed = Object.values(characters)
      .filter(ch => ch.controlledBy === 'general' && ch.instanceId !== removedCharacter.instanceId)
      .reduce((sum, ch) => sum + printedMind(defById(state, ch.definitionId)), 0);

    if (currentGIUsed + followerMind <= generalInfluenceControlLimit(state, controllerId)) {
      characters[followerId] = { ...follower, controlledBy: 'general' };
      logDetail(`${logPrefix}: follower ${followerId as string} falls to GI (mind ${followerMind}, GI used ${currentGIUsed})`);
    } else {
      for (const item of follower.items) sinks.discardOwn(toCardInstance(item));
      for (const ally of follower.allies) sinks.discardOwn(toCardInstance(ally));
      for (const hazard of follower.hazards) sinks.discardHazard(toCardInstance(hazard));
      sinks.discardOwn(toCardInstance(follower));
      delete characters[followerId];
      logDetail(`${logPrefix}: follower ${followerId as string} discarded (no GI room)`);
    }
  }
}
