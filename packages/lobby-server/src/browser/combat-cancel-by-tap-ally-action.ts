/**
 * @module combat-cancel-by-tap-ally-action
 *
 * Resolves the `cancel-by-tap` action (Slayer/Assassin "tap any character to
 * cancel an attack") for an ally attached to a company character, keyed by
 * the ally's own instance ID — the same key the engine uses on
 * {@link CancelByTapAction.characterId} (CRF 22 Ally: "Allies count as
 * characters for the purposes of combat").
 *
 * Regression for bug report "Slayer" (game mttrgt9q-d2jegf, seq 423): the
 * engine correctly offered `cancel-by-tap` targeting an ally, but
 * `renderCombatCharacterColumn` in combat-view.ts only wired the click
 * handler for company characters, not allies — clicking the ally did
 * nothing.
 */

import type { CancelByTapAction } from '@meccg/shared';

/** Finds the `cancel-by-tap` action, if any, whose actor is `allyInstanceId`. */
export function resolveCancelByTapAllyAction(
  actions: readonly CancelByTapAction[],
  allyInstanceId: string,
): CancelByTapAction | undefined {
  return actions.find(a => (a.characterId as string) === allyInstanceId);
}
