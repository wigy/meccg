/**
 * @module creature-storage
 *
 * Safety net for the `creature-storage` card effect (Elven Rope ba-34): a
 * creature card attached to an item via `ItemInPlay.storedCreature` instead
 * of living in a normal pile. The explicit release path (the item's bearer
 * becoming wounded) is handled inline in `combat-finalize.ts`. But an item
 * holding a stored creature can also leave play through any of the many
 * generic "discard/remove this item" reducer paths scattered across the
 * engine (grant-action costs, hazard-forced discards, character elimination,
 * item transfers, …), none of which know about `storedCreature`. Per the
 * project's invariant that no `CardInstance` may ever silently disappear
 * from state, this module runs as a `postReduce` prev/next diff (mirroring
 * `discard-on-card-leaves.ts`) and rescues any stored creature whose item
 * vanished without an explicit release: if the creature instance isn't
 * findable anywhere in the post-action state, it is pushed to the opposing
 * player's discard pile (its owner — a stored creature is always a hazard
 * card attached to a hero item, or vice versa).
 *
 * A no-op in the overwhelmingly common case: `combat-finalize.ts`'s
 * wound-release (and any future explicit release path) already places the
 * creature instance somewhere before this sweep runs, so `resolveInstanceId`
 * finds it and this module does nothing.
 */

import type { GameState, PlayerState } from '../index.js';
import { resolveInstanceId } from '../types/state.js';
import { logDetail } from './legal-actions/log.js';
import { updatePlayer } from './reducer-utils.js';

/**
 * Prev/next diff: for every `storedCreature` present in `prevState`, check
 * whether it's still reachable anywhere in `nextState`. If not — its item
 * left play through a path that didn't know to release it — push it to the
 * opposing player's discard pile so the instance is never lost.
 */
export function sweepOrphanedStoredCreatures(prevState: GameState, nextState: GameState): GameState {
  let result = nextState;
  for (let playerIndex = 0; playerIndex < prevState.players.length; playerIndex++) {
    const prevPlayer: PlayerState = prevState.players[playerIndex];
    for (const char of Object.values(prevPlayer.characters)) {
      for (const item of char.items) {
        const stored = item.storedCreature;
        if (!stored) continue;
        if (resolveInstanceId(result, stored.instanceId) !== undefined) continue;
        const opponentIndex = 1 - playerIndex;
        logDetail(`Creature storage: item ${item.instanceId as string} left play without releasing stored creature ${stored.instanceId as string} — routing it to player ${opponentIndex}'s discard pile`);
        result = updatePlayer(result, opponentIndex, p => ({
          ...p,
          discardPile: [...p.discardPile, stored],
        }));
      }
    }
  }
  return result;
}
