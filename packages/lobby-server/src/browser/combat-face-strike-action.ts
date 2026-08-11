/**
 * @module combat-face-strike-action
 *
 * Resolves the `face-strike-on-tap` action (Bow of Alatar wh-90) that applies
 * to a given in-play item, keyed by the item's own instance ID — the same key
 * the engine uses on {@link FaceStrikeOnTapAction.cardInstanceId}.
 *
 * Regression for bug report "Bow of Alatar" (game msokycb7-bbprzs, seq 1160):
 * during the Great Hunt, the engine correctly offered `face-strike-on-tap` to
 * let Alatar face a strike instead of Gollum (an ally attached to him), but
 * `renderCombatCharacterColumn` in combat-view.ts had no branch wiring a click
 * handler for it — clicking the bow item did nothing.
 */

import type { FaceStrikeOnTapAction } from '@meccg/shared';

/** Finds the `face-strike-on-tap` action, if any, whose item is `itemInstanceId`. */
export function resolveFaceStrikeOnTapAction(
  actions: readonly FaceStrikeOnTapAction[],
  itemInstanceId: string,
): FaceStrikeOnTapAction | undefined {
  return actions.find(a => (a.cardInstanceId as string) === itemInstanceId);
}
